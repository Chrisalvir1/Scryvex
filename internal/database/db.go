package database

import (
	"log"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var DB *gorm.DB

func InitDB(dsn string) {
	var err error
	DB, err = gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Printf("⚠️ No DB: %v\n", err)
		return
	}
	log.Println("✅ DB Connected")
}

type Camera struct {
	gorm.Model
	ID       uint   `gorm:"primarykey" json:"ID"`
	Name     string `json:"name"`
	URL      string `json:"url"`
	Type     string `json:"type"`
	Enabled  bool   `json:"enabled" gorm:"default:true"`
	AIStatus bool   `json:"ai_status" gorm:"default:false"`
	HasAuth  bool   `json:"has_auth" gorm:"default:false"`
}

func Migrate() {
	if DB == nil {
		return
	}
	DB.AutoMigrate(&Camera{})
	log.Println("✅ Migration Done")
}
