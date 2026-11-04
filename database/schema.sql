-- SmartStock AI - MySQL schema
-- Run in MySQL Workbench or:  mysql -u root -p < database/schema.sql

CREATE DATABASE IF NOT EXISTS smartstock CHARACTER SET utf8mb4;
USE smartstock;

CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('admin','staff') NOT NULL DEFAULT 'staff',
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id   INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS suppliers (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(120) NOT NULL,
  contact    VARCHAR(120),
  phone      VARCHAR(30),
  email      VARCHAR(150),
  address    VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  sku           VARCHAR(40) NOT NULL UNIQUE,
  name          VARCHAR(150) NOT NULL,
  category_id   INT,
  supplier_id   INT,
  price         DECIMAL(10,2) NOT NULL,
  quantity      INT NOT NULL DEFAULT 0,
  reorder_level INT NOT NULL DEFAULT 10,
  lead_time_days INT NOT NULL DEFAULT 3,
  description   TEXT,
  is_synthetic  TINYINT(1) NOT NULL DEFAULT 0,   -- 1 = demo data, not a real business record
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
  CONSTRAINT chk_qty CHECK (quantity >= 0)
);

CREATE TABLE IF NOT EXISTS sales (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  product_id   INT NOT NULL,
  quantity     INT NOT NULL,
  unit_price   DECIMAL(10,2) NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL,
  sale_date    DATE NOT NULL,
  user_id      INT,
  is_synthetic TINYINT(1) NOT NULL DEFAULT 0,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_sales_date (sale_date),
  INDEX idx_sales_product_date (product_id, sale_date)
);

CREATE TABLE IF NOT EXISTS purchases (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  supplier_id   INT NOT NULL,
  product_id    INT NOT NULL,
  quantity      INT NOT NULL,
  unit_cost     DECIMAL(10,2) NOT NULL,
  total_cost    DECIMAL(12,2) NOT NULL,
  purchase_date DATE NOT NULL,
  user_id       INT,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id)  REFERENCES products(id)  ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  product_id  INT NOT NULL,
  change_qty  INT NOT NULL,                       -- negative for sales, positive for purchases/adjustments
  reason      ENUM('sale','purchase','adjustment','initial') NOT NULL,
  reference_id INT,
  balance_after INT NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  INDEX idx_mov_product (product_id, created_at)
);
