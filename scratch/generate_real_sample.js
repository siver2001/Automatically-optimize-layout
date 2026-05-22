import { generateDieCutDxf } from '../server/utils/diecutDxfGenerator.js';

const samplePayload = {
  title: 'ASICS-DC-EOR-13',
  sheetWidth: 1789.4647,
  sheetHeight: 1027.5245,
  labelMode: 'prepared-sequence',
  sizeList: [
    { sizeName: '10.5Q' }
  ],
  sheets: [
    {
      sheetIndex: 0,
      sheetWidth: 1789.4647,
      sheetHeight: 1027.5245,
      placed: [
        {
          id: 'placed_1',
          sizeName: '10.5Q',
          foot: 'L',
          x: 200.5,
          y: 150.3,
          angle: 12.5,
          polygon: [
            { x: 260.842, y: 169.055 },
            { x: 280.5, y: 180.2 },
            { x: 275.1, y: 220.4 },
            { x: 250.3, y: 195.8 }
          ],
          internals: [
            [
              { x: 265.0, y: 185.0 },
              { x: 270.0, y: 200.0 }
            ]
          ]
        }
      ]
    }
  ]
};

const dxf = generateDieCutDxf(samplePayload);
const polys = dxf.split('\r\n  0\r\nPOLYLINE\r\n');
console.log('Tổng số polyline tìm thấy:', polys.length - 1);
console.log('\n--- Nội dung Polyline thứ 2 (Chi tiết) ---');
console.log(polys[2]);
