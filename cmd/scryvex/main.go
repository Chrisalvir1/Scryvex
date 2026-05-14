package main
import (
	"log"
	"net/http"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)
func main() {
	log.Println("🚀 Scryvex v2.0 Starting...")
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Get("/api/status", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status": "ok", "version": "2.0.0"}`))
	})
	log.Println("✅ Server listening on :1994")
	http.ListenAndServe(":1994", r)
}
