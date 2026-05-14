#!/usr/bin/env python3
"""
Scryvex AI Detection Engine
MOG2 pre-filtro → YoloFastestV2 → zonas → eventos MQTT
Compatible con Apple Silicon (coreml), Intel (openvino), ARM (cpu)
"""
import argparse, json, logging, os, platform, sys, time, threading, urllib.request
from dataclasses import dataclass, field
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [ai] %(message)s")
log = logging.getLogger("cambrige.ai")

try:
    import cv2
    import numpy as np
    CV2_OK = True
except ImportError:
    CV2_OK = False
    log.warning("opencv no disponible — modo mock activo")

COCO = ["person","bicycle","car","motorcycle","bus","truck","bird","cat","dog",
        "horse","sheep","cow","elephant","bear","zebra","bottle","chair","couch",
        "tv","laptop","mouse","keyboard","cell phone","microwave","oven","sink"]
PRIORITY = {"person","car","truck","motorcycle","dog","cat"}

@dataclass
class CameraConfig:
    camera_id:  str
    stream_url: str
    confidence: float = 0.50
    zones:      list  = field(default_factory=list)
    gpu_device: str   = "auto"

class Detector:
    def __init__(self, model_path: str, gpu_device: str = "auto"):
        self.net  = None
        self.mog2 = None
        self.gpu  = self._resolve(gpu_device)
        self._load(Path(model_path))

    def _resolve(self, d):
        if d != "auto": return d
        m = platform.machine().lower()
        if platform.system() == "Darwin" and ("arm" in m):
            return "coreml"
        return "cpu"

    def _load(self, p: Path):
        if not CV2_OK: return
        param = p.with_suffix(".param")
        binf  = p.with_suffix(".bin")
        if not param.exists():
            log.warning(f"Modelo no encontrado en {param} — usando mock")
            return
        try:
            self.net = cv2.dnn.readNetFromCaffe(str(param), str(binf))
            self.mog2 = cv2.createBackgroundSubtractorMOG2(300, 16, True)
            log.info(f"Modelo cargado ({self.gpu})")
        except Exception as e:
            log.error(f"Error cargando modelo: {e}")

    def has_motion(self, frame) -> bool:
        if not CV2_OK or self.mog2 is None: return True
        fg = self.mog2.apply(frame)
        fg[fg < 200] = 0
        return np.count_nonzero(fg) / fg.size > 0.003

    def detect(self, frame, conf_thresh=0.50) -> list:
        if not CV2_OK or self.net is None:
            return [{"class":"person","confidence":0.9,"priority":True}] if time.time()%30<1 else []
        h, w = frame.shape[:2]
        blob = cv2.dnn.blobFromImage(frame, 1/255.0, (352,352), swapRB=True, crop=False)
        self.net.setInput(blob)
        try:
            outs = self.net.forward(self.net.getUnconnectedOutLayersNames())
        except: return []
        detections = []
        for out in outs:
            for d in out:
                scores = d[5:]
                cid = int(np.argmax(scores)); conf = float(scores[cid])
                if conf < conf_thresh: continue
                cx,cy,bw,bh = d[0]*w,d[1]*h,d[2]*w,d[3]*h
                label = COCO[cid] if cid < len(COCO) else f"cls{cid}"
                detections.append({"class":label,"confidence":round(conf,3),
                    "bbox":[int(cx-bw/2),int(cy-bh/2),int(cx+bw/2),int(cy+bh/2)],
                    "priority":label in PRIORITY})
        return detections

class CameraDetector:
    def __init__(self, cfg: CameraConfig, detector: Detector, api_url: str):
        self.cfg = cfg; self.det = detector; self.api = api_url
        self.motion = False; self.last = 0.0

    def run(self):
        if not CV2_OK: self._mock(); return
        cap = cv2.VideoCapture(self.cfg.stream_url)
        if not cap.isOpened(): log.error(f"No se pudo abrir: {self.cfg.stream_url}"); self._mock(); return
        log.info(f"Detector iniciado: {self.cfg.camera_id}")
        while True:
            ret, frame = cap.read()
            if not ret: time.sleep(5); cap = cv2.VideoCapture(self.cfg.stream_url); continue
            if not self.det.has_motion(frame): continue
            dets = self.det.detect(frame, self.cfg.confidence)
            is_motion = len(dets) > 0
            if is_motion != self.motion or (is_motion and time.time()-self.last > 5):
                self.motion = is_motion; self.last = time.time()
                self._emit("motion" if is_motion else "motion_end", dets)
        cap.release()

    def _emit(self, event, dets):
        log.info(f"[{self.cfg.camera_id}] {event}: {[d['class'] for d in dets]}")
        try:
            data = json.dumps({"camera_id":self.cfg.camera_id,"event":event}).encode()
            req = urllib.request.Request(self.api+"/motion",data=data,
                headers={"Content-Type":"application/json"},method="POST")
            urllib.request.urlopen(req, timeout=2)
        except: pass

    def _mock(self):
        log.info(f"[{self.cfg.camera_id}] mock activo")
        while True: time.sleep(30); self._emit("motion",[{"class":"person","confidence":0.9}])

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--config",  default="./configs/cambrige.yaml")
    p.add_argument("--api-url", default="http://localhost:7878")
    p.add_argument("--gpu",     default="auto")
    args = p.parse_args()

    try:
        import yaml
        cfg = yaml.safe_load(open(args.config))
        cameras = cfg.get("cameras", [])
    except:
        cameras = []

    detector = Detector("./ai_engine/models/yolo-fastest.param", args.gpu)
    threads = []
    for cam in cameras:
        if not cam.get("enabled", True): continue
        cd = CameraDetector(CameraConfig(cam["id"], cam.get("url",""),
             cfg.get("ai",{}).get("confidence",0.5) if isinstance(cfg,dict) else 0.5), detector, args.api_url)
        t = threading.Thread(target=cd.run, daemon=True)
        t.start(); threads.append(t)
        log.info(f"Detector: {cam['id']}")

    if not threads:
        log.warning("No hay cámaras — esperando config...")
        while True: time.sleep(60)

    try:
        for t in threads: t.join()
    except KeyboardInterrupt:
        log.info("AI Engine detenido")

if __name__ == "__main__": main()
