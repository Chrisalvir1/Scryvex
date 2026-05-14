package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/chrisalvir/scryvex/internal/database"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func main() {
	log.Println("🚀 Scryvex v2.0 Starting...")

	// Configuración de DB
	dsn := "host=localhost user=chrisalvir dbname=scryvex port=5432 sslmode=disable"
	database.InitDB(dsn)
	database.Migrate()

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))

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
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "ok",
			"version": "2.0.0",
			"message": "Scryvex Core Online",
		})
	})

	// API de Cámaras
	r.Get("/api/cameras", func(w http.ResponseWriter, r *http.Request) {
		var cameras []database.Camera
		if database.DB != nil {
			database.DB.Find(&cameras)
		}
		json.NewEncoder(w).Encode(cameras)
	})

	r.Post("/api/cameras", func(w http.ResponseWriter, r *http.Request) {
		var cam database.Camera
		if err := json.NewDecoder(r.Body).Decode(&cam); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if database.DB != nil {
			database.DB.Create(&cam)
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(cam)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "1994"
	}

	srv := &http.Server{
		Addr:    ":" + port,
		Handler: r,
	}

	go func() {
		log.Printf("✅ Server listening on http://localhost:%s\n", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %s\n", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("👋 Shutting down Scryvex...")
}
