const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

async function downloadBlob(endpoint, payload, fallbackName) {
  const response = await fetch(`${API_BASE_URL}/diecut/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    let message = `Khong the xuat file ${fallbackName}`;
    try {
      const data = await response.json();
      message = data?.error || message;
    } catch {
      // ignore parse failure
    }
    throw new Error(message);
  }

  const disposition = response.headers.get('Content-Disposition') || '';
  const fileNameMatch = disposition.match(/filename=([^;]+)/i);
  const fileName = fileNameMatch
    ? fileNameMatch[1].trim().replace(/^"|"$/g, '')
    : fallbackName;

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

class DieCutExportService {
  async exportPdf(payload) {
    return downloadBlob('export-pdf', payload, 'diecut-layouts.pdf');
  }

  async exportDxf(payload) {
    return downloadBlob('export-dxf', payload, 'diecut-layouts.dxf');
  }
}

export const diecutExportService = new DieCutExportService();
