'use strict';
// Lectura y parseo de multipart/form-data sin dependencias externas.

function leerMultipart(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parsearMultipart(buffer, boundary) {
  const sep = Buffer.from('--' + boundary);
  const partes = [];
  let start = 0;

  while (start < buffer.length) {
    const sepIdx = buffer.indexOf(sep, start);
    if (sepIdx === -1) break;
    const headerStart = sepIdx + sep.length + 2;
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd === -1) break;

    const headerStr = buffer.slice(headerStart, headerEnd).toString();
    const contentEnd = buffer.indexOf(sep, headerEnd + 4) - 2;

    if (contentEnd > headerEnd + 4) {
      const content = buffer.slice(headerEnd + 4, contentEnd);
      const nameMatch = headerStr.match(/name="([^"]+)"/);
      const filenameMatch = headerStr.match(/filename="([^"]+)"/);
      const typeMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);
      partes.push({
        name: nameMatch ? nameMatch[1] : null,
        filename: filenameMatch ? filenameMatch[1] : null,
        contentType: typeMatch ? typeMatch[1].trim() : 'text/plain',
        data: content,
      });
    }
    start = sepIdx + sep.length;
  }
  return partes;
}

module.exports = { leerMultipart, parsearMultipart };
