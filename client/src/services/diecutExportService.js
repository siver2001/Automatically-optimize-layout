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
  constructor() {
    this.sheetDetailCache = new Map();
    this.sheetDetailPromiseCache = new Map();
  }

  hasSheetDetailCacheEntry(resultId, sheetIndex) {
    return this.sheetDetailCache.has(`${resultId}:${sheetIndex}`);
  }

  async exportPdf(payload) {
    return downloadBlob('export-pdf', payload, 'diecut-layouts.pdf');
  }

  async exportDxf(payload) {
    return downloadBlob('export-dxf', payload, 'diecut-layouts.dxf');
  }

  async exportCyc(payload) {
    return downloadBlob('export-cyc', payload, 'diecut-layouts.CYC');
  }

  async fetchNestingSheetDetail(resultId, sheetIndex) {
    const cacheKey = `${resultId}:${sheetIndex}`;
    if (this.sheetDetailCache.has(cacheKey)) {
      return this.sheetDetailCache.get(cacheKey);
    }
    if (this.sheetDetailPromiseCache.has(cacheKey)) {
      return this.sheetDetailPromiseCache.get(cacheKey);
    }

    const request = fetch(`${API_BASE_URL}/diecut/nest-sheet-detail`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ resultId, sheetIndex })
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          if (response.status === 404) {
            this.sheetDetailCache.set(cacheKey, null);
            return null;
          }
          throw new Error(data?.error || 'Khong the tai chi tiet tam.');
        }
        const sheet = data?.sheet || null;
        this.sheetDetailCache.set(cacheKey, sheet);
        return sheet;
      })
      .finally(() => {
        this.sheetDetailPromiseCache.delete(cacheKey);
      });

    this.sheetDetailPromiseCache.set(cacheKey, request);
    return request;
  }

  async fetchNestingSheetDetails(resultId, sheetIndexes = []) {
    const uniqueIndexes = [...new Set((sheetIndexes || []).map((value) => Math.max(0, Number(value) || 0)))];
    const missingIndexes = uniqueIndexes.filter((index) => !this.sheetDetailCache.has(`${resultId}:${index}`));

    if (missingIndexes.length) {
      const response = await fetch(`${API_BASE_URL}/diecut/nest-sheet-details`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ resultId, sheetIndexes: missingIndexes })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Khong the tai chi tiet tam.');
      }

      const loadedIndexSet = new Set();
      for (const entry of data?.sheets || []) {
        loadedIndexSet.add(entry.sheetIndex);
        this.sheetDetailCache.set(`${resultId}:${entry.sheetIndex}`, entry.sheet || null);
      }
      for (const index of missingIndexes) {
        if (!loadedIndexSet.has(index)) {
          this.sheetDetailCache.set(`${resultId}:${index}`, null);
        }
      }
    }

    return uniqueIndexes
      .map((index) => ({
        sheetIndex: index,
        sheet: this.sheetDetailCache.get(`${resultId}:${index}`)
      }))
      .filter((entry) => entry.sheet);
  }

  clearNestingSheetDetailCache() {
    this.sheetDetailCache.clear();
    this.sheetDetailPromiseCache.clear();
  }
}

export const diecutExportService = new DieCutExportService();
