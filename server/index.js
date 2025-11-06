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

// Kiểm tra môi trường để quyết định cách phục vụ ứng dụng React
const isProduction = process.env.NODE_ENV === 'production'; 

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Routes (API routes should always be available)
app.use('/api/packing', packingRoutes);
app.use('/api/modbus', modbusRoutes);

// Phục vụ static files và React app CHỈ TRONG CHẾ ĐỘ SẢN XUẤT
if (isProduction) {
    // Phục vụ các file tĩnh từ client/build
    app.use(express.static(path.join(__dirname, '..', 'client', 'build')));

    // Phục vụ React app (fallback cho các route client-side)
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, '..', 'client', 'build', 'index.html'));
    });
}


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

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});