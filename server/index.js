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
import diecutRoutes from './routes/diecutRoutes.js';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, { 
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});
app.set('io', io);

const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  exposedHeaders: ['Content-Disposition']
})); 
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Routes API
app.use('/api/packing', packingRoutes);
app.use('/api/modbus', modbusRoutes);
app.use('/api/diecut', diecutRoutes);

// Serve React build folder
const buildPath = path.join(__dirname, '../client/build');
app.use(express.static(buildPath));

// Fallback để hỗ trợ React Router
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

const startServer = (port) => {
  server.listen(port, () => {
    const actualPort = server.address().port;
    console.log(`Server running on port ${actualPort}`);
    
    if (process.send) {
      process.send({ type: 'server-ready', port: actualPort });
    }
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} is busy, trying ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });
};

startServer(PORT);