const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const cors = require('cors');

const app = express();
const PORT = 3000;
const SECRET_KEY = 'your_secret_key';

app.use(cors());
app.use(bodyParser.json());

// In-memory users and inventory storage (now user-specific)
const users = [];
const userInventories = {}; // Each user will have their own inventory
let inventoryIdCounter = 1;

// Middleware to authenticate token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Access token missing' });

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid token' });
    req.user = user;
    next();
  });
}

// Register
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ message: 'Username and password required' });

  const existingUser = users.find(u => u.username === username);
  if (existingUser) return res.status(409).json({ message: 'Username already exists' });

  const hashedPassword = await bcrypt.hash(password, 10);
  users.push({ username, password: hashedPassword });
  res.status(201).json({ message: 'User registered successfully' });
});

// Login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ message: 'Username and password required' });

  const user = users.find(u => u.username === username);
  if (!user) return res.status(401).json({ message: 'Invalid credentials' });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ message: 'Invalid credentials' });

  const token = jwt.sign({ username: user.username }, SECRET_KEY, { expiresIn: '1h' });
  res.json({ token });
});

// Get all inventory items for the authenticated user with optional search/filter
app.get('/inventory', authenticateToken, (req, res) => {
  const username = req.user.username;
  const userInventory = userInventories[username] || [];
  
  // Apply search/filter if provided
  const { search, minPrice, maxPrice, minQuantity, maxQuantity } = req.query;
  let filteredInventory = userInventory;
  
  if (search) {
    filteredInventory = filteredInventory.filter(item => 
      item.name.toLowerCase().includes(search.toLowerCase())
    );
  }
  
  if (minPrice) {
    filteredInventory = filteredInventory.filter(item => item.price >= parseFloat(minPrice));
  }
  
  if (maxPrice) {
    filteredInventory = filteredInventory.filter(item => item.price <= parseFloat(maxPrice));
  }
  
  if (minQuantity) {
    filteredInventory = filteredInventory.filter(item => item.quantity >= parseInt(minQuantity));
  }
  
  if (maxQuantity) {
    filteredInventory = filteredInventory.filter(item => item.quantity <= parseInt(maxQuantity));
  }
  
  res.json(filteredInventory);
});

// Get inventory item by id for the authenticated user
app.get('/inventory/:id', authenticateToken, (req, res) => {
  const username = req.user.username;
  const userInventory = userInventories[username] || [];
  const id = parseInt(req.params.id);
  const item = userInventory.find(i => i.id === id);
  if (!item) return res.status(404).json({ message: 'Item not found' });
  res.json(item);
});

// Create inventory item for the authenticated user
app.post('/inventory', authenticateToken, (req, res) => {
  const username = req.user.username;
  const { name, quantity, price, category, description } = req.body;
  if (!name || quantity == null || price == null) {
    return res.status(400).json({ message: 'Name, quantity, and price are required' });
  }
  
  // Initialize user inventory if it doesn't exist
  if (!userInventories[username]) {
    userInventories[username] = [];
  }
  
  const newItem = { 
    id: inventoryIdCounter++, 
    name, 
    quantity, 
    price,
    category: category || 'General',
    description: description || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  userInventories[username].push(newItem);
  res.status(201).json(newItem);
});

// Update inventory item (advanced update operations)
app.put('/inventory/:id', authenticateToken, (req, res) => {
  const username = req.user.username;
  const userInventory = userInventories[username] || [];
  const id = parseInt(req.params.id);
  const item = userInventory.find(i => i.id === id);
  if (!item) return res.status(404).json({ message: 'Item not found' });

  const { name, quantity, price, category, description } = req.body;
  if (name !== undefined) item.name = name;
  if (quantity !== undefined) item.quantity = quantity;
  if (price !== undefined) item.price = price;
  if (category !== undefined) item.category = category;
  if (description !== undefined) item.description = description;
  item.updatedAt = new Date().toISOString();

  res.json(item);
});

// Partial update inventory item (PATCH for advanced operations)
app.patch('/inventory/:id', authenticateToken, (req, res) => {
  const username = req.user.username;
  const userInventory = userInventories[username] || [];
  const id = parseInt(req.params.id);
  const item = userInventory.find(i => i.id === id);
  if (!item) return res.status(404).json({ message: 'Item not found' });

  const { operation, value } = req.body;
  
  switch (operation) {
    case 'increment_quantity':
      item.quantity += parseInt(value) || 1;
      break;
    case 'decrement_quantity':
      item.quantity = Math.max(0, item.quantity - (parseInt(value) || 1));
      break;
    case 'adjust_price':
      item.price += parseFloat(value) || 0;
      item.price = Math.max(0, item.price);
      break;
    case 'set_low_stock':
      item.lowStock = parseInt(value) || 5;
      break;
    default:
      return res.status(400).json({ message: 'Invalid operation' });
  }
  
  item.updatedAt = new Date().toISOString();
  res.json(item);
});

// Bulk update operations
app.patch('/inventory/bulk', authenticateToken, (req, res) => {
  const username = req.user.username;
  const userInventory = userInventories[username] || [];
  const { operation, ids, value } = req.body;
  
  if (!ids || !Array.isArray(ids)) {
    return res.status(400).json({ message: 'IDs array is required' });
  }
  
  const updatedItems = [];
  
  ids.forEach(id => {
    const item = userInventory.find(i => i.id === parseInt(id));
    if (item) {
      switch (operation) {
        case 'bulk_price_increase':
          item.price += parseFloat(value) || 0;
          break;
        case 'bulk_category_update':
          item.category = value || 'General';
          break;
        case 'bulk_quantity_adjust':
          item.quantity += parseInt(value) || 0;
          item.quantity = Math.max(0, item.quantity);
          break;
      }
      item.updatedAt = new Date().toISOString();
      updatedItems.push(item);
    }
  });
  
  res.json({ message: `${updatedItems.length} items updated`, items: updatedItems });
});

// Delete inventory item for the authenticated user
app.delete('/inventory/:id', authenticateToken, (req, res) => {
  const username = req.user.username;
  const userInventory = userInventories[username] || [];
  const id = parseInt(req.params.id);
  const index = userInventory.findIndex(i => i.id === id);
  if (index === -1) return res.status(404).json({ message: 'Item not found' });

  userInventories[username].splice(index, 1);
  res.json({ message: 'Item deleted' });
});

// Get inventory statistics for the authenticated user
app.get('/inventory/stats/summary', authenticateToken, (req, res) => {
  const username = req.user.username;
  const userInventory = userInventories[username] || [];
  
  const stats = {
    totalItems: userInventory.length,
    totalValue: userInventory.reduce((sum, item) => sum + (item.price * item.quantity), 0),
    totalQuantity: userInventory.reduce((sum, item) => sum + item.quantity, 0),
    categories: [...new Set(userInventory.map(item => item.category))],
    lowStockItems: userInventory.filter(item => item.quantity < (item.lowStock || 5)),
    averagePrice: userInventory.length > 0 ? userInventory.reduce((sum, item) => sum + item.price, 0) / userInventory.length : 0
  };
  
  res.json(stats);
});

app.listen(PORT, () => {
  console.log(`Inventory management server running on port ${PORT}`);
});
