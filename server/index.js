import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import packingRoutes from './routes/packing.js';
import modbusRoutes from './routes/modbus.js';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, { 
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors()); 
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));

// Routes API
app.use('/api/packing', packingRoutes);
app.use('/api/modbus', modbusRoutes);

// ✅ THÊM: Serve React build folder
const buildPath = path.join(__dirname, '../client/build');
app.use(express.static(buildPath));

// ✅ THÊM: Fallback để hỗ trợ React Router
app.get('*', (req, res) => {
  res.sendFile(path.join(buildPath, 'index.html'));
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
  
  socket.on('start-packing', (data) => {
    console.log('Starting packing optimization:', data);
    socket.emit('packing-progress', { progress: 0, message: 'Bắt đầu tối ưu...' });
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('--- SERVER PHIÊN BAN MỚI NHẤT ĐÃ CHẠY ---');
  
  if (process.send) {
    process.send('server-ready');
  }
});