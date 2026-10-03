import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import net from 'net';
import path from 'path';
import fs from 'fs';
import os from 'os';
import multer from 'multer';

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Directories for temporary uploads and receiver
const TEMP_DIR = path.join(process.cwd(), 'temp_uploads');
const RECEIVED_DIR = path.join(process.cwd(), 'temp_received');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
if (!fs.existsSync(RECEIVED_DIR)) fs.mkdirSync(RECEIVED_DIR, { recursive: true });

// Setup multer storage preserving relative paths when provided
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, TEMP_DIR);
  },
  filename: (_req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${unique}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
  }
});
const upload = multer({ storage });

// Helper: Format bytes like Java code
function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// Helper: Render progress bar string [########------] 40%
function buildProgressBar(atual: number, total: number): { bar: string; percentage: number } {
  if (total <= 0) return { bar: '[--------------------] 0%', percentage: 0 };
  const percentage = Math.min(100, Math.floor((atual * 100) / total));
  const blocos = Math.floor(percentage / 5);
  let bar = '[';
  for (let i = 0; i < 20; i++) {
    bar += i < blocos ? '#' : '-';
  }
  bar += `] ${percentage}%`;
  return { bar, percentage };
}

// Java DataOutputStream writeUTF simulation: 2 bytes length (big endian) + UTF-8 bytes
function writeJavaUTF(str: string): Buffer {
  const strBuf = Buffer.from(str, 'utf8');
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(strBuf.length, 0);
  return Buffer.concat([lenBuf, strBuf]);
}

// Java DataInputStream readUTF simulation
function readJavaUTF(buf: Buffer, offset: number = 0): { str: string; nextOffset: number } | null {
  if (buf.length < offset + 2) return null;
  const len = buf.readUInt16BE(offset);
  if (buf.length < offset + 2 + len) return null;
  const str = buf.toString('utf8', offset + 2, offset + 2 + len);
  return { str, nextOffset: offset + 2 + len };
}

// Get Local IPs
function getLocalNetworkIPs() {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(interfaces)) {
    const ifaceList = interfaces[name];
    if (ifaceList) {
      for (const address of ifaceList) {
        if (address.family === 'IPv4' && !address.internal) {
          addresses.push(address.address);
        }
      }
    }
  }
  return addresses;
}

// ==========================================
// BUILT-IN TEST RECEIVER SERVER (TCP)
// ==========================================
let testServer: net.Server | null = null;
let testServerPort: number = 8989;
let testServerRunning = false;
let testServerLogs: string[] = [];
let receivedFilesList: Array<{ name: string; size: number; receivedAt: string; path: string }> = [];

function startTestServer(port: number = 8989): Promise<{ success: boolean; port: number; message: string }> {
  return new Promise((resolve) => {
    if (testServerRunning && testServer) {
      return resolve({ success: true, port: testServerPort, message: 'Servidor receptor já está em execução.' });
    }

    testServerPort = port;
    testServer = net.createServer((socket) => {
      const clientAddr = `${socket.remoteAddress}:${socket.remotePort}`;
      addTestLog(`[Receptor] Nova conexão recebida de ${clientAddr}`);

      let state: 'READ_COUNT' | 'READ_FILE_HEADER' | 'READ_FILE_CONTENT' | 'DONE' = 'READ_COUNT';
      let totalFilesToReceive = 0;
      let filesReceivedCount = 0;
      let currentFileName = '';
      let currentFileSize = 0;
      let currentFileBytesRead = 0;
      let currentFileStream: fs.WriteStream | null = null;

      let bufferAccumulator = Buffer.alloc(0);

      socket.on('data', (chunk) => {
        bufferAccumulator = Buffer.concat([bufferAccumulator, chunk]);

        let keepProcessing = true;
        while (keepProcessing && bufferAccumulator.length > 0) {
          if (state === 'READ_COUNT') {
            if (bufferAccumulator.length >= 4) {
              totalFilesToReceive = bufferAccumulator.readInt32BE(0);
              bufferAccumulator = bufferAccumulator.subarray(4);
              addTestLog(`[Receptor] Quantidade de arquivos a receber: ${totalFilesToReceive}`);
              state = totalFilesToReceive > 0 ? 'READ_FILE_HEADER' : 'DONE';
            } else {
              keepProcessing = false;
            }
          } else if (state === 'READ_FILE_HEADER') {
            // Need 2 bytes (len) + name + 8 bytes (long size)
            if (bufferAccumulator.length >= 2) {
              const nameLen = bufferAccumulator.readUInt16BE(0);
              const headerTotalLen = 2 + nameLen + 8;
              if (bufferAccumulator.length >= headerTotalLen) {
                currentFileName = bufferAccumulator.toString('utf8', 2, 2 + nameLen);
                // BigInt 64-bit size
                const sizeBig = bufferAccumulator.readBigInt64BE(2 + nameLen);
                currentFileSize = Number(sizeBig);
                currentFileBytesRead = 0;

                bufferAccumulator = bufferAccumulator.subarray(headerTotalLen);

                addTestLog(`[Receptor] Recebendo arquivo [${filesReceivedCount + 1}/${totalFilesToReceive}]: ${currentFileName} (${formatarTamanho(currentFileSize)})`);

                // Ensure directory
                const safeRel = currentFileName.replace(/\\/g, '/');
                const savePath = path.join(RECEIVED_DIR, safeRel);
                fs.mkdirSync(path.dirname(savePath), { recursive: true });
                currentFileStream = fs.createWriteStream(savePath);

                state = 'READ_FILE_CONTENT';
              } else {
                keepProcessing = false;
              }
            } else {
              keepProcessing = false;
            }
          } else if (state === 'READ_FILE_CONTENT') {
            const neededBytes = currentFileSize - currentFileBytesRead;
            const availableBytes = bufferAccumulator.length;
            const bytesToWrite = Math.min(neededBytes, availableBytes);

            if (bytesToWrite > 0) {
              const slice = bufferAccumulator.subarray(0, bytesToWrite);
              if (currentFileStream) {
                currentFileStream.write(slice);
              }
              currentFileBytesRead += bytesToWrite;
              bufferAccumulator = bufferAccumulator.subarray(bytesToWrite);
            }

            if (currentFileBytesRead >= currentFileSize) {
              if (currentFileStream) {
                currentFileStream.end();
                currentFileStream = null;
              }
              filesReceivedCount++;
              addTestLog(`[Receptor] ✓ Arquivo gravado com sucesso: ${currentFileName} (${formatarTamanho(currentFileSize)})`);
              
              receivedFilesList.unshift({
                name: currentFileName,
                size: currentFileSize,
                receivedAt: new Date().toLocaleTimeString(),
                path: currentFileName
              });

              if (filesReceivedCount >= totalFilesToReceive) {
                state = 'DONE';
                addTestLog(`[Receptor] Todos os ${totalFilesToReceive} arquivos recebidos! Respondendo 'OK'...`);
                
                // Send "OK" in Java UTF format
                const okBuf = writeJavaUTF('OK');
                socket.write(okBuf);
                socket.end();
                keepProcessing = false;
              } else {
                state = 'READ_FILE_HEADER';
              }
            } else {
              keepProcessing = false;
            }
          } else if (state === 'DONE') {
            keepProcessing = false;
          }
        }
      });

      socket.on('error', (err) => {
        addTestLog(`[Receptor] Erro no socket cliente: ${err.message}`);
        if (currentFileStream) {
          currentFileStream.end();
        }
      });

      socket.on('close', () => {
        addTestLog(`[Receptor] Conexão com ${clientAddr} encerrada.`);
        if (currentFileStream) {
          currentFileStream.end();
        }
      });
    });

    testServer.on('error', (err: any) => {
      addTestLog(`[Receptor] Falha ao iniciar servidor: ${err.message}`);
      testServerRunning = false;
      resolve({ success: false, port, message: `Erro ao escutar na porta ${port}: ${err.message}` });
    });

    testServer.listen(port, '0.0.0.0', () => {
      testServerRunning = true;
      addTestLog(`[Receptor] Servidor Receptor de Testes INICIADO na porta ${port}`);
      resolve({ success: true, port, message: `Servidor receptor escutando na porta ${port}` });
    });
  });
}

function stopTestServer(): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    if (!testServer || !testServerRunning) {
      testServerRunning = false;
      return resolve({ success: true, message: 'Servidor receptor já estava parado.' });
    }
    testServer.close((err) => {
      testServerRunning = false;
      testServer = null;
      addTestLog('[Receptor] Servidor receptor parado.');
      resolve({ success: !err, message: err ? err.message : 'Servidor receptor parado.' });
    });
  });
}

function addTestLog(msg: string) {
  const timestamp = new Date().toLocaleTimeString();
  testServerLogs.push(`[${timestamp}] ${msg}`);
  if (testServerLogs.length > 200) testServerLogs.shift();
}

// Generate demo files on disk if needed
function ensureDemoFiles(): Array<{ name: string; relativePath: string; fullPath: string; size: number }> {
  const demoDir = path.join(TEMP_DIR, 'demo_pasta_servidor');
  fs.mkdirSync(path.join(demoDir, 'documentos'), { recursive: true });
  fs.mkdirSync(path.join(demoDir, 'imagens'), { recursive: true });
  fs.mkdirSync(path.join(demoDir, 'sistema'), { recursive: true });

  const f1 = path.join(demoDir, 'documentos', 'relatorio_backup.pdf');
  const f2 = path.join(demoDir, 'imagens', 'foto_camera_001.jpg');
  const f3 = path.join(demoDir, 'sistema', 'configuracao.json');
  const f4 = path.join(demoDir, 'dados_transmissao.txt');

  if (!fs.existsSync(f1)) {
    // Write 150KB dummy PDF header
    const b = Buffer.alloc(150 * 1024, 'PDF-1.4\nSimulacao de arquivo para transmissao TCP Socket Java.');
    fs.writeFileSync(f1, b);
  }
  if (!fs.existsSync(f2)) {
    // 320KB dummy JPG
    const b = Buffer.alloc(320 * 1024, 0x55);
    fs.writeFileSync(f2, b);
  }
  if (!fs.existsSync(f3)) {
    const jsonStr = JSON.stringify({ protocolo: 'TCP Java Socket', versao: '1.0', porta: 8989, criadoEm: new Date().toISOString() }, null, 2);
    fs.writeFileSync(f3, jsonStr);
  }
  if (!fs.existsSync(f4)) {
    const text = 'Transmissor de Arquivos TCP Socket - Pacote de teste pronto para envio.\n'.repeat(50);
    fs.writeFileSync(f4, text);
  }

  const list: Array<{ name: string; relativePath: string; fullPath: string; size: number }> = [];
  function scan(dir: string, base: string) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const full = path.join(dir, item);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        scan(full, base);
      } else {
        list.push({
          name: item,
          relativePath: path.relative(base, full).replace(/\\/g, '/'),
          fullPath: full,
          size: st.size
        });
      }
    }
  }
  scan(demoDir, demoDir);
  return list;
}

// ==========================================
// API ROUTES
// ==========================================

// 1. System & Network info
app.get('/api/system-info', (_req: Request, res: Response) => {
  const localIps = getLocalNetworkIPs();
  res.json({
    localIps,
    platform: os.platform(),
    hostname: os.hostname(),
    testServerRunning,
    testServerPort,
    defaultJavaPath: '/storage/emulated/0/Download/servidor'
  });
});

// 2. Test Server control & status
app.get('/api/test-server/status', (_req: Request, res: Response) => {
  res.json({
    running: testServerRunning,
    port: testServerPort,
    logs: testServerLogs,
    receivedFiles: receivedFilesList
  });
});

app.post('/api/test-server/start', async (req: Request, res: Response) => {
  const port = parseInt(req.body.port, 10) || 8989;
  const result = await startTestServer(port);
  res.json(result);
});

app.post('/api/test-server/stop', async (_req: Request, res: Response) => {
  const result = await stopTestServer();
  res.json(result);
});

app.post('/api/test-server/clear', (_req: Request, res: Response) => {
  testServerLogs = [];
  receivedFilesList = [];
  res.json({ success: true });
});

// 3. Download received test file
app.get('/api/test-server/download/:filename(*)', (req: Request, res: Response) => {
  const requestedFile = req.params.filename;
  const safePath = path.join(RECEIVED_DIR, requestedFile.replace(/\.\./g, ''));
  if (fs.existsSync(safePath)) {
    res.download(safePath);
  } else {
    res.status(404).json({ error: 'Arquivo não encontrado' });
  }
});

// 4. Sample files
app.get('/api/sample-files', (_req: Request, res: Response) => {
  const files = ensureDemoFiles();
  res.json({
    baseFolder: '/storage/emulated/0/Download/servidor (Demonstração)',
    files: files.map(f => ({ name: f.name, relativePath: f.relativePath, size: f.size, sizeFormatted: formatarTamanho(f.size) }))
  });
});

// 5. Upload files from browser for immediate transmission
app.post('/api/upload-files', upload.array('files'), (req: Request, res: Response) => {
  const uploadedFiles = req.files as Express.Multer.File[];
  if (!uploadedFiles || uploadedFiles.length === 0) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  }

  // The client may pass relativePaths array as JSON in req.body.relativePaths
  let relativePaths: string[] = [];
  if (req.body.relativePaths) {
    try {
      relativePaths = JSON.parse(req.body.relativePaths);
    } catch {
      relativePaths = [];
    }
  }

  const results = uploadedFiles.map((file, idx) => ({
    name: file.originalname,
    relativePath: relativePaths[idx] || file.originalname,
    tempPath: file.path,
    size: file.size,
    sizeFormatted: formatarTamanho(file.size)
  }));

  res.json({ success: true, count: results.length, files: results });
});

// 6. EXECUTE TRANSMISSION (SSE Streaming Log)
// This matches the exact Java socket communication protocol from TransmissorArquivos.java!
app.post('/api/transmit', async (req: Request, res: Response) => {
  const ip = (req.body.ip || '192.168.1.10').trim();
  const port = parseInt(req.body.port, 10) || 8989;
  const timeoutMs = parseInt(req.body.timeout, 10) || 5000;
  const sourceMode = req.body.sourceMode || 'sample'; // 'sample', 'uploaded', or 'server_folder'
  const customFolderPath = req.body.customFolderPath || '/storage/emulated/0/Download/servidor';

  // Set SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const sendLog = (text: string) => {
    sendEvent('log', { text });
  };

  sendLog('=================================');
  sendLog('     TRANSMISSOR DE ARQUIVOS     ');
  sendLog('=================================');
  sendLog(`Pasta:`);
  sendLog(`${sourceMode === 'server_folder' ? customFolderPath : sourceMode === 'uploaded' ? 'Arquivos selecionados pelo usuário' : '/storage/emulated/0/Download/servidor (Amostra)'}`);

  // Gather files to transmit
  let filesToTransmit: Array<{ relativePath: string; fullPath: string; size: number }> = [];

  if (sourceMode === 'uploaded' && Array.isArray(req.body.uploadedFileList)) {
    for (const item of req.body.uploadedFileList) {
      if (item.tempPath && fs.existsSync(item.tempPath)) {
        filesToTransmit.push({
          relativePath: item.relativePath || item.name,
          fullPath: item.tempPath,
          size: item.size || fs.statSync(item.tempPath).size
        });
      }
    }
  } else if (sourceMode === 'server_folder') {
    if (fs.existsSync(customFolderPath)) {
      function scan(dir: string, base: string) {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const full = path.join(dir, item);
          const st = fs.statSync(full);
          if (st.isDirectory()) {
            scan(full, base);
          } else {
            filesToTransmit.push({
              relativePath: path.relative(base, full).replace(/\\/g, '/'),
              fullPath: full,
              size: st.size
            });
          }
        }
      }
      scan(customFolderPath, customFolderPath);
    } else {
      sendLog('');
      sendLog('ERRO: pasta não encontrada!');
      sendLog(customFolderPath);
      sendEvent('error', { message: `Pasta não encontrada no servidor: ${customFolderPath}` });
      res.end();
      return;
    }
  } else {
    // Default demo/sample files
    const samples = ensureDemoFiles();
    filesToTransmit = samples.map(s => ({
      relativePath: s.relativePath,
      fullPath: s.fullPath,
      size: s.size
    }));
  }

  sendLog('');
  sendLog(`Arquivos encontrados: ${filesToTransmit.length}`);

  if (filesToTransmit.length === 0) {
    sendLog('Nenhum arquivo para enviar.');
    sendEvent('error', { message: 'Nenhum arquivo para enviar.' });
    res.end();
    return;
  }

  sendLog('');
  sendLog(`Conectando ao servidor ${ip}:${port}...`);

  const socket = new net.Socket();
  let socketConnected = false;
  let connectionTimeout: NodeJS.Timeout | null = null;

  // Cleanup helper
  const cleanup = () => {
    if (connectionTimeout) clearTimeout(connectionTimeout);
    if (!socket.destroyed) socket.destroy();
  };

  req.on('close', () => {
    cleanup();
  });

  connectionTimeout = setTimeout(() => {
    if (!socketConnected) {
      sendLog('');
      sendLog(`ERRO: Conexão expirou após ${timeoutMs}ms ao tentar conectar em ${ip}:${port}`);
      sendLog('Verifique se o celular/servidor está ligado e na mesma rede Wi-Fi.');
      sendEvent('error', { message: `Tempo limite de conexão esgotado (${timeoutMs}ms)` });
      cleanup();
      res.end();
    }
  }, timeoutMs);

  socket.connect(port, ip, async () => {
    socketConnected = true;
    if (connectionTimeout) clearTimeout(connectionTimeout);

    socket.setNoDelay(true);
    socket.setKeepAlive(true);

    sendLog('Conectado ao servidor!');
    sendEvent('connected', { ip, port });

    try {
      // 1. Send total count: saida.writeInt(arquivos.size()) -> 4 bytes BE
      const countBuf = Buffer.alloc(4);
      countBuf.writeInt32BE(filesToTransmit.length, 0);
      socket.write(countBuf);

      const bufferChunkSize = 8192;
      let numero = 0;
      let totalBytesAllFiles = filesToTransmit.reduce((acc, f) => acc + f.size, 0);
      let cumulativeBytesSent = 0;

      for (const file of filesToTransmit) {
        numero++;
        const relativo = file.relativePath;
        const tamanho = file.size;

        sendLog('');
        sendLog('---------------------------------');
        sendLog(`Arquivo ${numero}/${filesToTransmit.length}`);
        sendLog(relativo);
        sendLog(`Tamanho: ${formatarTamanho(tamanho)}`);

        // 2. Envia caminho: saida.writeUTF(relativo)
        const utfBuf = writeJavaUTF(relativo);
        socket.write(utfBuf);

        // 3. Envia tamanho: saida.writeLong(tamanho) -> 8 bytes BigInt BE
        const longBuf = Buffer.alloc(8);
        longBuf.writeBigInt64BE(BigInt(tamanho), 0);
        socket.write(longBuf);

        // 4. Envia conteudo em chunks de 8192
        let enviado = 0;
        const fileHandle = fs.openSync(file.fullPath, 'r');
        const chunkBuf = Buffer.alloc(bufferChunkSize);

        let lastPercentageReported = -1;
        let lastReportTime = Date.now();

        while (enviado < tamanho) {
          const toRead = Math.min(bufferChunkSize, tamanho - enviado);
          const bytesRead = fs.readSync(fileHandle, chunkBuf, 0, toRead, enviado);
          if (bytesRead <= 0) break;

          const slice = chunkBuf.subarray(0, bytesRead);

          // Write and handle socket backpressure if needed
          const canWriteMore = socket.write(slice);
          if (!canWriteMore) {
            await new Promise((resolve) => socket.once('drain', resolve));
          }

          enviado += bytesRead;
          cumulativeBytesSent += bytesRead;

          const { bar, percentage } = buildProgressBar(enviado, tamanho);
          const now = Date.now();
          if (percentage !== lastPercentageReported && (percentage % 5 === 0 || percentage === 100 || now - lastReportTime > 200)) {
            lastPercentageReported = percentage;
            lastReportTime = now;
            sendEvent('progress', {
              numero,
              totalArquivos: filesToTransmit.length,
              relativo,
              enviado,
              tamanho,
              porcentagem: percentage,
              barra: bar,
              totalGeralEnviado: cumulativeBytesSent,
              totalGeralBytes: totalBytesAllFiles
            });
          }
        }
        fs.closeSync(fileHandle);

        const finalBar = buildProgressBar(tamanho, tamanho);
        sendLog(finalBar.bar);
        sendLog('');
        sendLog('✓ Enviado');
        sendEvent('file_done', { numero, relativo, tamanho });
      }

      // 5. Espera confirmacao: entrada.readUTF()
      sendLog('');
      sendLog('Aguardando confirmação do servidor...');

      let responseBuffer = Buffer.alloc(0);
      const onResponseData = (data: Buffer) => {
        responseBuffer = Buffer.concat([responseBuffer, data]);
        const utfRead = readJavaUTF(responseBuffer);
        if (utfRead) {
          socket.off('data', onResponseData);
          const resposta = utfRead.str;

          sendLog('');
          sendLog('=================================');
          if (resposta === 'OK') {
            sendLog('TRANSFERÊNCIA CONCLUÍDA!');
            sendEvent('finished', { success: true, resposta });
          } else {
            sendLog(`Resposta do servidor: ${resposta}`);
            sendEvent('finished', { success: false, resposta });
          }
          sendLog('=================================');

          cleanup();
          res.end();
        }
      };

      socket.on('data', onResponseData);

      // If after 10s no confirmation, notify
      setTimeout(() => {
        if (!res.writableEnded) {
          sendLog('Aviso: tempo de espera pela confirmação expirou.');
          sendEvent('finished', { success: true, resposta: 'OK (Sem confirmação remota explícita)' });
          cleanup();
          res.end();
        }
      }, 10000);

    } catch (err: any) {
      sendLog('');
      sendLog(`ERRO: ${err.message}`);
      sendEvent('error', { message: err.message });
      cleanup();
      res.end();
    }
  });

  socket.on('error', (err: any) => {
    if (connectionTimeout) clearTimeout(connectionTimeout);
    sendLog('');
    sendLog(`ERRO: ${err.message}`);
    let explanation = '';
    if (err.code === 'ECONNREFUSED') {
      explanation = `Conexão recusada em ${ip}:${port}. O aplicativo receptor no celular/computador está ativo e escutando na porta ${port}?`;
    } else if (err.code === 'EHOSTUNREACH') {
      explanation = `Host inalcançável: ${ip}. Verifique se o dispositivo está ligado e na mesma sub-rede Wi-Fi.`;
    } else if (err.code === 'ETIMEDOUT') {
      explanation = `Tempo de conexão esgotado para ${ip}:${port}.`;
    }
    if (explanation) sendLog(explanation);
    sendEvent('error', { message: explanation || err.message, code: err.code });
    cleanup();
    res.end();
  });
});

// Setup Vite development or production static serving
async function startServer() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`> Transmissor Arquivos Web App ouvindo na porta ${PORT}`);
  });
}

startServer();
