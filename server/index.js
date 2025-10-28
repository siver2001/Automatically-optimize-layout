import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

// Define __filename and __dirname equivalent for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import packingRoutes from './routes/packing.js';
import modbusRoutes from './routes/modbus.js';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, { 
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
// Serve static files from client/build
app.use(express.static(path.join(__dirname, '..', 'client', 'build')));

// Routes
app.use('/api/packing', packingRoutes);
app.use('/api/modbus', modbusRoutes);

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
  
  // Packing optimization events
  socket.on('start-packing', (data) => {
    console.log('Starting packing optimization:', data);
    // Emit packing progress updates
    socket.emit('packing-progress', { progress: 0, message: 'Bắt đầu tối ưu...' });
  });
});

// Serve React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'build', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});