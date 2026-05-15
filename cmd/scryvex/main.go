package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/chrisalvir/scryvex/internal/database"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/shirou/gopsutil/v3/process"
)

func main() {
	log.Println("🚀 Scryvex v2.0 Starting...")

	// Configuración de DB desde variables de entorno
	dbHost := os.Getenv("DB_HOST")
	if dbHost == "" {
		dbHost = "localhost"
	}
	dbUser := os.Getenv("DB_USER")
	if dbUser == "" {
		dbUser = "postgres"
	}
	dbName := os.Getenv("DB_NAME")
	if dbName == "" {
		dbName = "scryvex"
	}
	dbPort := os.Getenv("DB_PORT")
	if dbPort == "" {
		dbPort = "5432"
	}
	dbPassword := os.Getenv("DB_PASSWORD")

	dsn := fmt.Sprintf(
		"host=%s user=%s password=%s dbname=%s port=%s sslmode=disable",
		dbHost, dbUser, dbPassword, dbName, dbPort,
	)
	database.InitDB(dsn)
	database.Migrate()

	// Cargar cámaras existentes en go2rtc
	go func() {
		time.Sleep(5 * time.Second)
		var cameras []database.Camera
		database.DB.Find(&cameras)
		for _, cam := range cameras {
			log.Printf("📡 Registrando cámara: %s\n", cam.Name)
			url := "http://localhost:1984/api/streams?name=" + cam.Name + "&src=" + cam.URL
			req, err := http.NewRequest(http.MethodPut, url, nil)
			if err != nil {
				log.Printf("⚠️ Error creando request para cámara %s: %v\n", cam.Name, err)
				continue
			}
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				log.Printf("⚠️ Error registrando cámara %s en go2rtc: %v\n", cam.Name, err)
				continue
			}
			resp.Body.Close()
			log.Printf("✅ Cámara %s registrada (status: %d)\n", cam.Name, resp.StatusCode)
		}
	}()

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	// CORS
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}
			next.ServeHTTP(w, r)
		})
	})

	r.Get("/api/status", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "ok", "version": "2.0.0"})
	})

	r.Get("/api/system", func(w http.ResponseWriter, r *http.Request) {
		p, _ := process.NewProcess(int32(os.Getpid()))
		cpuVal, _ := p.CPUPercent()
		memInfo, _ := p.MemoryInfo()
		json.NewEncoder(w).Encode(map[string]interface{}{
			"cpu":    cpuVal / 10.0,
			"memory": float64(memInfo.RSS) / 1024 / 1024 / 10,
		})
	})

	r.Get("/api/cameras", func(w http.ResponseWriter, r *http.Request) {
		var cameras []database.Camera
		if database.DB != nil {
			database.DB.Find(&cameras)
		}
		json.NewEncoder(w).Encode(cameras)
	})

	r.Post("/api/cameras", func(w http.ResponseWriter, r *http.Request) {
		var cam database.Camera
		json.NewDecoder(r.Body).Decode(&cam)
		if database.DB != nil {
			database.DB.Create(&cam)
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(cam)
	})

	r.Delete("/api/cameras/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		if database.DB != nil {
			database.DB.Delete(&database.Camera{}, id)
		}
		w.WriteHeader(http.StatusNoContent)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "1994"
	}

	srv := &http.Server{Addr: ":" + port, Handler: r}

	go func() {
		log.Printf("✅ Server listening on http://localhost:%s\n", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %s\n", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("⏳ Shutting down Scryvex gracefully...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("❌ Server forced to shutdown: %v", err)
	}
	log.Println("👋 Scryvex shutdown complete")
}
