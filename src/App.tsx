import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Square,
  Terminal as TerminalIcon,
  Server,
  Folder,
  FileText,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Download,
  Copy,
  Check,
  Smartphone,
  Wifi,
  HardDrive,
  Code2,
  UploadCloud,
  Trash2,
  Radio,
  FileCode,
  ShieldCheck,
  ExternalLink,
  ChevronRight,
  Database
} from 'lucide-react';

interface FileItem {
  name: string;
  relativePath: string;
  size: number;
  sizeFormatted: string;
  tempPath?: string;
  fileObj?: File;
}

interface SystemInfo {
  localIps: string[];
  platform: string;
  hostname: string;
  testServerRunning: boolean;
  testServerPort: number;
  defaultJavaPath: string;
}

interface TestServerStatus {
  running: boolean;
  port: number;
  logs: string[];
  receivedFiles: Array<{ name: string; size: number; receivedAt: string; path: string }>;
}

export default function App() {
  // Configuration State
  const [serverIp, setServerIp] = useState<string>('192.168.1.10');
  const [serverPort, setServerPort] = useState<number>(8989);
  const [timeoutMs, setTimeoutMs] = useState<number>(5000);
  const [sourceMode, setSourceMode] = useState<'sample' | 'uploaded' | 'server_folder'>('sample');
  const [customFolder, setCustomFolder] = useState<string>('/storage/emulated/0/Download/servidor');

  // Validation Logic for IP and Port
  const validateIp = (ip: string): { isValid: boolean; error: string | null } => {
    const trimmed = ip.trim();
    if (!trimmed) {
      return { isValid: false, error: 'O endereço IP não pode ficar vazio' };
    }
    if (trimmed.toLowerCase() === 'localhost') {
      return { isValid: true, error: null };
    }
    const parts = trimmed.split('.');
    if (parts.length !== 4) {
      return { isValid: false, error: 'Formato inválido. Use 4 blocos separados por pontos (ex: 192.168.1.10)' };
    }
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!/^\d+$/.test(part)) {
        return { isValid: false, error: `Bloco ${i + 1} ("${part}") deve conter apenas números` };
      }
      const num = parseInt(part, 10);
      if (num < 0 || num > 255) {
        return { isValid: false, error: `Valor "${part}" inválido. Cada bloco deve estar entre 0 e 255` };
      }
      if (part.length > 1 && part.startsWith('0')) {
        return { isValid: false, error: `Bloco "${part}" inválido: zeros à esquerda não são permitidos` };
      }
    }
    return { isValid: true, error: null };
  };

  const validatePort = (port: number | string): { isValid: boolean; error: string | null } => {
    const str = String(port).trim();
    if (!str) {
      return { isValid: false, error: 'O número da porta é obrigatório' };
    }
    if (!/^\d+$/.test(str)) {
      return { isValid: false, error: 'A porta deve conter apenas números inteiros' };
    }
    const p = parseInt(str, 10);
    if (p < 1 || p > 65535) {
      return { isValid: false, error: 'Porta fora do intervalo permitido (deve ser entre 1 e 65535)' };
    }
    return { isValid: true, error: null };
  };

  const ipValidation = validateIp(serverIp);
  const portValidation = validatePort(serverPort);
  const isFormValid = ipValidation.isValid && portValidation.isValid;

  // File items
  const [sampleFiles, setSampleFiles] = useState<FileItem[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<FileItem[]>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  // Transmission execution state
  const [isTransmitting, setIsTransmitting] = useState<boolean>(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([
    'Pronto para executar a transmissão de arquivos.',
    'Configure o IP e a Porta do servidor receptor ou ative o receptor de testes integrado.',
    'Clique em "EXECUTAR TRANSMISSÃO" para iniciar o envio via TCP Socket.'
  ]);
  const [transmissionStatus, setTransmissionStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [currentProgress, setCurrentProgress] = useState<{
    fileNum: number;
    totalFiles: number;
    currentFile: string;
    percentage: number;
    bar: string;
    bytesSent: number;
    totalBytes: number;
  } | null>(null);

  // System & Test Server
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const [testServerStatus, setTestServerStatus] = useState<TestServerStatus>({
    running: false,
    port: 8989,
    logs: [],
    receivedFiles: []
  });
  const [testServerPortInput, setTestServerPortInput] = useState<number>(8989);
  const [testServerBusy, setTestServerBusy] = useState<boolean>(false);

  // UI Tabs & Helpers
  const [activeTab, setActiveTab] = useState<'terminal' | 'receiver' | 'java_code' | 'protocol'>('terminal');
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [copiedTermux, setCopiedTermux] = useState<boolean>(false);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);

  const terminalEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Load Initial Info
  useEffect(() => {
    fetchSystemInfo();
    fetchSampleFiles();
    fetchTestServerStatus();

    const interval = setInterval(() => {
      fetchTestServerStatus();
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  // Auto-scroll terminal
  useEffect(() => {
    if (autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollTop = terminalEndRef.current.scrollHeight;
    }
  }, [terminalLogs, autoScroll]);

  const fetchSystemInfo = async () => {
    try {
      const res = await fetch('/api/system-info');
      const data = await res.json();
      setSysInfo(data);
    } catch (e) {
      console.error('Erro ao obter dados do sistema:', e);
    }
  };

  const fetchSampleFiles = async () => {
    try {
      const res = await fetch('/api/sample-files');
      const data = await res.json();
      setSampleFiles(data.files || []);
    } catch (e) {
      console.error('Erro ao carregar arquivos de amostra:', e);
    }
  };

  const fetchTestServerStatus = async () => {
    try {
      const res = await fetch('/api/test-server/status');
      const data = await res.json();
      setTestServerStatus(data);
    } catch (e) {
      // ignore in silent poll
    }
  };

  const toggleTestServer = async () => {
    setTestServerBusy(true);
    try {
      if (testServerStatus.running) {
        await fetch('/api/test-server/stop', { method: 'POST' });
      } else {
        await fetch('/api/test-server/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ port: testServerPortInput })
        });
      }
      await fetchTestServerStatus();
    } catch (e) {
      console.error('Erro ao alternar servidor receptor:', e);
    } finally {
      setTestServerBusy(false);
    }
  };

  const handleClearTestServer = async () => {
    try {
      await fetch('/api/test-server/clear', { method: 'POST' });
      await fetchTestServerStatus();
    } catch (e) {
      console.error('Erro ao limpar receptor:', e);
    }
  };

  // Upload local files / folders
  const handleFilesChosen = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);

    const formData = new FormData();
    const relativePaths: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      formData.append('files', file);
      // WebkitRelativePath is available when choosing folders
      const rel = file.webkitRelativePath || file.name;
      relativePaths.push(rel);
    }
    formData.append('relativePaths', JSON.stringify(relativePaths));

    try {
      const res = await fetch('/api/upload-files', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success && data.files) {
        setUploadedFiles(prev => [...prev, ...data.files]);
        setSourceMode('uploaded');
        addLog(`[UI] ${data.count} arquivo(s) adicionado(s) à fila de envio.`);
      }
    } catch (err: any) {
      addLog(`[UI] Erro ao carregar arquivos: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const addLog = (msg: string) => {
    setTerminalLogs(prev => [...prev, msg]);
  };

  const clearTerminal = () => {
    setTerminalLogs([]);
  };

  // EXECUTE TRANSMISSION (THE BUTTON)
  const handleExecuteTransmission = async () => {
    if (!isFormValid || isTransmitting) return;

    setIsTransmitting(true);
    setTransmissionStatus('running');
    clearTerminal();
    setCurrentProgress(null);

    const controller = new AbortController();
    setAbortController(controller);

    try {
      const payload: any = {
        ip: serverIp,
        port: serverPort,
        timeout: timeoutMs,
        sourceMode,
        customFolderPath: customFolder
      };

      if (sourceMode === 'uploaded') {
        payload.uploadedFileList = uploadedFiles;
      }

      const response = await fetch('/api/transmit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.body) {
        throw new Error('Falha ao estabelecer conexão com o fluxo de transmissão.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const block of lines) {
          if (!block.trim()) continue;
          const eventMatch = block.match(/event:\s*(.+)/);
          const dataMatch = block.match(/data:\s*(.+)/);

          const eventName = eventMatch ? eventMatch[1].trim() : 'message';
          const dataStr = dataMatch ? dataMatch[1].trim() : '';

          try {
            const parsedData = JSON.parse(dataStr);

            if (eventName === 'log') {
              addLog(parsedData.text);
            } else if (eventName === 'progress') {
              setCurrentProgress({
                fileNum: parsedData.numero,
                totalFiles: parsedData.totalArquivos,
                currentFile: parsedData.relativo,
                percentage: parsedData.porcentagem,
                bar: parsedData.barra,
                bytesSent: parsedData.totalGeralEnviado,
                totalBytes: parsedData.totalGeralBytes
              });
            } else if (eventName === 'finished') {
              if (parsedData.success) {
                setTransmissionStatus('success');
              } else {
                setTransmissionStatus('error');
              }
            } else if (eventName === 'error') {
              setTransmissionStatus('error');
            }
          } catch {
            // raw string fallback
            if (dataStr) addLog(dataStr);
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        addLog('');
        addLog('(!) Transmissão cancelada manualmente pelo usuário.');
        setTransmissionStatus('idle');
      } else {
        addLog('');
        addLog(`ERRO: ${err.message}`);
        setTransmissionStatus('error');
      }
    } finally {
      setIsTransmitting(false);
      setAbortController(null);
    }
  };

  const handleAbortTransmission = () => {
    if (abortController) {
      abortController.abort();
    }
  };

  // Helper format bytes
  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  // Current files active in list based on sourceMode
  const activeFilesList = sourceMode === 'uploaded' ? uploadedFiles : sampleFiles;
  const totalPayloadBytes = activeFilesList.reduce((acc, f) => acc + f.size, 0);

  // Generate Java Source Code with customized IP, Port, Folder
  const generatedJavaCode = `import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.util.*;

public class TransmissorArquivos {

    // IP DO CELULAR SERVIDOR
    // CONFIGURADO: ${serverIp}
    private static final String IP_SERVIDOR = "${serverIp}";

    // Porta do receptor
    private static final int PORTA = ${serverPort};

    // Pasta que será enviada
    private static final Path PASTA_ORIGEM =
            Paths.get("${customFolder.replace(/\\/g, '\\\\')}");

    public static void main(String[] args) {

        System.out.println("=================================");
        System.out.println("     TRANSMISSOR DE ARQUIVOS     ");
        System.out.println("=================================");

        System.out.println("Pasta:");
        System.out.println(PASTA_ORIGEM);

        if (!Files.exists(PASTA_ORIGEM)) {

            System.out.println();
            System.out.println("ERRO: pasta não encontrada!");
            System.out.println(PASTA_ORIGEM);
            return;
        }

        try {

            List<Path> arquivos = listarArquivos();

            System.out.println();
            System.out.println(
                    "Arquivos encontrados: "
                            + arquivos.size()
            );

            if (arquivos.isEmpty()) {

                System.out.println(
                        "Nenhum arquivo para enviar."
                );

                return;
            }

            enviarArquivos(arquivos);

        } catch (Exception e) {

            System.out.println();
            System.out.println(
                    "ERRO: " + e.getMessage()
            );

            e.printStackTrace();
        }
    }

    // ============================================================
    // LISTAR TODOS OS ARQUIVOS
    // ============================================================

    private static List<Path> listarArquivos()
            throws IOException {

        List<Path> arquivos = new ArrayList<>();

        try (var stream =
                     Files.walk(PASTA_ORIGEM)) {

            stream
                    .filter(Files::isRegularFile)
                    .forEach(arquivos::add);
        }

        return arquivos;
    }

    // ============================================================
    // ENVIAR ARQUIVOS
    // ============================================================

    private static void enviarArquivos(
            List<Path> arquivos)
            throws IOException {

        System.out.println();
        System.out.println(
                "Conectando ao servidor " + IP_SERVIDOR + ":" + PORTA + "..."
        );

        try (Socket socket =
                     new Socket()) {

            socket.connect(
                    new InetSocketAddress(
                            IP_SERVIDOR,
                            PORTA
                    ),
                    ${timeoutMs}
            );

            socket.setTcpNoDelay(true);
            socket.setKeepAlive(true);

            System.out.println(
                    "Conectado ao servidor!"
            );

            DataOutputStream saida =
                    new DataOutputStream(
                            new BufferedOutputStream(
                                    socket.getOutputStream()
                            )
                    );

            DataInputStream entrada =
                    new DataInputStream(
                            new BufferedInputStream(
                                    socket.getInputStream()
                            )
                    );

            // Quantidade de arquivos
            saida.writeInt(
                    arquivos.size()
            );

            saida.flush();

            byte[] buffer =
                    new byte[8192];

            int numero = 0;

            for (Path arquivo : arquivos) {

                numero++;

                // Caminho relativo
                String relativo =
                        PASTA_ORIGEM
                                .relativize(arquivo)
                                .toString();

                // Tamanho
                long tamanho =
                        Files.size(arquivo);

                System.out.println();
                System.out.println(
                        "---------------------------------"
                );

                System.out.println(
                        "Arquivo "
                                + numero
                                + "/"
                                + arquivos.size()
                );

                System.out.println(
                        relativo
                );

                System.out.println(
                        "Tamanho: "
                                + formatarTamanho(tamanho)
                );

                // Envia caminho
                saida.writeUTF(relativo);

                // Envia tamanho
                saida.writeLong(tamanho);

                // Envia conteúdo
                try (InputStream arquivoEntrada =
                             new BufferedInputStream(
                                     Files.newInputStream(
                                             arquivo
                                     ))) {

                    long enviado = 0;

                    while (enviado < tamanho) {

                        int lidos =
                                arquivoEntrada.read(
                                        buffer
                                );

                        if (lidos == -1) {
                            break;
                        }

                        saida.write(
                                buffer,
                                0,
                                lidos
                        );

                        enviado += lidos;

                        mostrarProgresso(
                                enviado,
                                tamanho
                        );
                    }
                }

                saida.flush();

                System.out.println();
                System.out.println(
                        "✓ Enviado"
                );
            }

            // Espera confirmação
            String resposta =
                    entrada.readUTF();

            System.out.println();
            System.out.println(
                    "================================="
            );

            if ("OK".equals(resposta)) {

                System.out.println(
                        "TRANSFERÊNCIA CONCLUÍDA!"
                );

            } else {

                System.out.println(
                        "Resposta do servidor: "
                                + resposta
                );
            }

            System.out.println(
                    "================================="
            );
        }
    }

    // ============================================================
    // BARRA DE PROGRESSO
    // ============================================================

    private static void mostrarProgresso(
            long atual,
            long total) {

        if (total <= 0) {
            return;
        }

        int porcentagem =
                (int) ((atual * 100) / total);

        int blocos =
                porcentagem / 5;

        StringBuilder barra =
                new StringBuilder();

        barra.append("[");

        for (int i = 0; i < 20; i++) {

            if (i < blocos) {
                barra.append("#");
            } else {
                barra.append("-");
            }
        }

        barra.append("] ");

        barra.append(porcentagem);
        barra.append("%");

        System.out.print(
                "\\r" + barra
        );
    }

    // ============================================================
    // TAMANHO DO ARQUIVO
    // ============================================================

    private static String formatarTamanho(
            long bytes) {

        if (bytes < 1024) {
            return bytes + " B";
        }

        if (bytes < 1024 * 1024) {

            return String.format(
                    Locale.US,
                    "%.2f KB",
                    bytes / 1024.0
            );
        }

        if (bytes < 1024L * 1024L * 1024L) {

            return String.format(
                    Locale.US,
                    "%.2f MB",
                    bytes /
                            (1024.0 * 1024.0)
            );
        }

        return String.format(
                Locale.US,
                "%.2f GB",
                bytes /
                        (1024.0 *
                         1024.0 *
                         1024.0)
        );
    }
}`;

  // Java Receiver Code for reference
  const javaReceiverCode = `import java.io.*;
import java.net.*;
import java.nio.file.*;

public class ReceptorArquivos {

    private static final int PORTA = ${serverPort};
    private static final Path PASTA_DESTINO = Paths.get("arquivos_recebidos");

    public static void main(String[] args) throws IOException {
        Files.createDirectories(PASTA_DESTINO);
        System.out.println("Servidor Receptor escutando na porta " + PORTA + "...");

        try (ServerSocket serverSocket = new ServerSocket(PORTA)) {
            while (true) {
                try (Socket socket = serverSocket.accept()) {
                    System.out.println("Conexão recebida de: " + socket.getRemoteSocketAddress());
                    DataInputStream entrada = new DataInputStream(new BufferedInputStream(socket.getInputStream()));
                    DataOutputStream saida = new DataOutputStream(new BufferedOutputStream(socket.getOutputStream()));

                    int totalArquivos = entrada.readInt();
                    System.out.println("Recebendo " + totalArquivos + " arquivos...");

                    byte[] buffer = new byte[8192];
                    for (int i = 0; i < totalArquivos; i++) {
                        String relativo = entrada.readUTF();
                        long tamanho = entrada.readLong();
                        System.out.println("[" + (i + 1) + "/" + totalArquivos + "] Recebendo: " + relativo + " (" + tamanho + " bytes)");

                        Path destino = PASTA_DESTINO.resolve(relativo);
                        Files.createDirectories(destino.getParent());

                        try (OutputStream arquivoSaida = new BufferedOutputStream(Files.newOutputStream(destino))) {
                            long recebido = 0;
                            while (recebido < tamanho) {
                                int toRead = (int) Math.min(buffer.length, tamanho - recebido);
                                int lidos = entrada.read(buffer, 0, toRead);
                                if (lidos == -1) break;
                                arquivoSaida.write(buffer, 0, lidos);
                                recebido += lidos;
                            }
                        }
                    }

                    // Envia confirmação OK
                    saida.writeUTF("OK");
                    saida.flush();
                    System.out.println("✓ Todos os arquivos recebidos com sucesso!");
                } catch (Exception e) {
                    System.err.println("Erro na transferência: " + e.getMessage());
                }
            }
        }
    }
}`;

  const downloadJavaFile = () => {
    const blob = new Blob([generatedJavaCode], { type: 'text/x-java-source;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'TransmissorArquivos.java';
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyCode = (text: string, type: 'code' | 'termux') => {
    navigator.clipboard.writeText(text);
    if (type === 'code') {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } else {
      setCopiedTermux(true);
      setTimeout(() => setCopiedTermux(false), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Top Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-50 px-4 lg:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-900/30 border border-cyan-400/30">
              <Radio className="h-5 w-5 text-white animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-lg tracking-tight text-white flex items-center gap-2">
                  Transmissor de Arquivos
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-cyan-950/90 text-cyan-400 border border-cyan-800/60 font-medium">
                    TCP Socket Java
                  </span>
                </h1>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                Execução de comando socket cliente para Android/Linux com envio rápido em lotes
              </p>
            </div>
          </div>

          {/* Quick status & test server badge */}
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 bg-slate-900/90 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300">
              <Wifi className="h-3.5 w-3.5 text-emerald-400" />
              <span>IPs da Máquina:</span>
              {sysInfo?.localIps && sysInfo.localIps.length > 0 ? (
                sysInfo.localIps.map((ip, idx) => (
                  <button
                    key={idx}
                    onClick={() => setServerIp(ip)}
                    title="Clique para definir como IP alvo"
                    className="font-mono text-cyan-300 hover:text-cyan-100 hover:underline bg-slate-800/80 px-1.5 py-0.5 rounded"
                  >
                    {ip}
                  </button>
                ))
              ) : (
                <span className="font-mono text-slate-400">127.0.0.1</span>
              )}
            </div>

            <button
              onClick={toggleTestServer}
              disabled={testServerBusy}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all shadow-sm ${
                testServerStatus.running
                  ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-300 hover:bg-emerald-900/50'
                  : 'bg-slate-800/90 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
            >
              <Server className={`h-3.5 w-3.5 ${testServerStatus.running ? 'text-emerald-400 animate-pulse' : 'text-slate-400'}`} />
              <span>
                {testServerStatus.running
                  ? `Receptor Teste ON (:8989)`
                  : 'Ligar Receptor de Teste'}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-6 space-y-6">
        
        {/* TOP BANNER: Big Executor Command Box */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-900/95 to-slate-900 border border-slate-800 rounded-2xl p-5 lg:p-6 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
          
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
            
            {/* Parameters Settings */}
            <div className="lg:col-span-7 space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-cyan-500/20 text-cyan-400 text-xs font-bold border border-cyan-500/30 shadow-[0_0_10px_rgba(6,182,212,0.2)]">1</span>
                  <div>
                    <h2 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
                      Endereço de Conexão TCP Socket
                      <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800/80 font-mono">
                        Configuração do Java
                      </span>
                    </h2>
                    <p className="text-[11px] text-slate-400">Edite as caixas abaixo para apontar para o seu dispositivo alvo</p>
                  </div>
                </div>
              </div>

              {/* DUAS GRANDES CAIXAS VISÍVEIS COM VALIDAÇÃO: IP E PORTA */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5">
                {/* CAIXA 1: IP DO SERVIDOR */}
                <div className={`sm:col-span-8 rounded-2xl p-4 border-2 transition-all shadow-lg ${
                  ipValidation.isValid
                    ? 'bg-slate-950/90 border-cyan-500/50 shadow-cyan-950/40 hover:border-cyan-400 focus-within:border-cyan-400 focus-within:ring-4 focus-within:ring-cyan-500/20'
                    : 'bg-rose-950/20 border-rose-500 shadow-rose-950/40 focus-within:border-rose-400 focus-within:ring-4 focus-within:ring-rose-500/25'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                      <Wifi className={`h-4 w-4 ${ipValidation.isValid ? 'text-cyan-400' : 'text-rose-400'}`} />
                      <span>IP do Servidor</span>
                    </label>
                    
                    {ipValidation.isValid ? (
                      <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-emerald-950/90 text-emerald-400 border border-emerald-700/80 flex items-center gap-1 shadow-sm">
                        <CheckCircle2 className="h-3 w-3" />
                        IP_SERVIDOR Válido
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-rose-950 text-rose-300 border border-rose-600 flex items-center gap-1 animate-pulse shadow-sm">
                        <AlertCircle className="h-3 w-3 text-rose-400" />
                        IP Inválido
                      </span>
                    )}
                  </div>

                  <div className="relative">
                    <input
                      type="text"
                      value={serverIp}
                      onChange={(e) => setServerIp(e.target.value)}
                      placeholder="192.168.1.10"
                      className={`w-full rounded-xl px-4 py-3 text-lg sm:text-xl font-mono font-bold outline-none transition-all shadow-inner border ${
                        ipValidation.isValid
                          ? 'bg-slate-900/90 border-cyan-500/30 text-cyan-200 focus:border-cyan-400 placeholder:text-slate-600'
                          : 'bg-rose-950/40 border-rose-500 text-rose-100 focus:border-rose-400 placeholder:text-rose-400/60 ring-1 ring-rose-500/40'
                      }`}
                    />
                  </div>

                  {/* Mensagem de Erro de IP */}
                  {!ipValidation.isValid && (
                    <div className="mt-2.5 flex items-center gap-2 text-xs text-rose-300 bg-rose-950/70 border border-rose-800/80 rounded-lg px-3 py-2 animate-fadeIn">
                      <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
                      <span className="font-medium">{ipValidation.error}</span>
                    </div>
                  )}

                  {/* Atalhos rápidos para o IP */}
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-800/80">
                    <span className="text-[10px] text-slate-400 mr-1 font-medium">Atalhos rápidos:</span>
                    <button
                      type="button"
                      onClick={() => setServerIp('192.168.1.10')}
                      className={`text-[11px] font-mono px-2 py-1 rounded-lg border transition-all ${
                        serverIp === '192.168.1.10'
                          ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 font-bold shadow-sm'
                          : 'bg-slate-900 border-slate-750 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      192.168.1.10 (Padrão)
                    </button>
                    <button
                      type="button"
                      onClick={() => setServerIp('127.0.0.1')}
                      className={`text-[11px] font-mono px-2 py-1 rounded-lg border transition-all ${
                        serverIp === '127.0.0.1'
                          ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 font-bold shadow-sm'
                          : 'bg-slate-900 border-slate-750 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      127.0.0.1 (Localhost)
                    </button>
                    {sysInfo?.localIps?.filter(ip => ip !== '127.0.0.1' && ip !== '192.168.1.10').slice(0, 2).map((ip, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setServerIp(ip)}
                        className={`text-[11px] font-mono px-2 py-1 rounded-lg border transition-all ${
                          serverIp === ip
                            ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 font-bold shadow-sm'
                            : 'bg-slate-900 border-slate-750 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                        }`}
                      >
                        {ip}
                      </button>
                    ))}
                  </div>
                </div>

                {/* CAIXA 2: PORTA DO SERVIDOR */}
                <div className={`sm:col-span-4 rounded-2xl p-4 border-2 transition-all shadow-lg ${
                  portValidation.isValid
                    ? 'bg-slate-950/90 border-cyan-500/50 shadow-cyan-950/40 hover:border-cyan-400 focus-within:border-cyan-400 focus-within:ring-4 focus-within:ring-cyan-500/20'
                    : 'bg-rose-950/20 border-rose-500 shadow-rose-950/40 focus-within:border-rose-400 focus-within:ring-4 focus-within:ring-rose-500/25'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                      <Radio className={`h-4 w-4 ${portValidation.isValid ? 'text-cyan-400' : 'text-rose-400'}`} />
                      <span>Porta</span>
                    </label>
                    
                    {portValidation.isValid ? (
                      <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-emerald-950/90 text-emerald-400 border border-emerald-700/80 flex items-center gap-1 shadow-sm">
                        <CheckCircle2 className="h-3 w-3" />
                        PORTA Válida
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-rose-950 text-rose-300 border border-rose-600 flex items-center gap-1 animate-pulse shadow-sm">
                        <AlertCircle className="h-3 w-3 text-rose-400" />
                        Porta Inválida
                      </span>
                    )}
                  </div>

                  <div className="relative">
                    <input
                      type="number"
                      value={serverPort}
                      onChange={(e) => setServerPort(Number(e.target.value))}
                      placeholder="8989"
                      className={`w-full rounded-xl px-4 py-3 text-lg sm:text-xl font-mono font-bold outline-none transition-all shadow-inner border ${
                        portValidation.isValid
                          ? 'bg-slate-900/90 border-cyan-500/30 text-cyan-200 focus:border-cyan-400 placeholder:text-slate-600'
                          : 'bg-rose-950/40 border-rose-500 text-rose-100 focus:border-rose-400 placeholder:text-rose-400/60 ring-1 ring-rose-500/40'
                      }`}
                    />
                  </div>

                  {/* Mensagem de Erro de Porta */}
                  {!portValidation.isValid && (
                    <div className="mt-2.5 flex items-center gap-2 text-xs text-rose-300 bg-rose-950/70 border border-rose-800/80 rounded-lg px-3 py-2 animate-fadeIn">
                      <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
                      <span className="font-medium">{portValidation.error}</span>
                    </div>
                  )}

                  {/* Atalhos rápidos para a Porta */}
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-800/80">
                    <button
                      type="button"
                      onClick={() => setServerPort(8989)}
                      className={`text-[11px] font-mono px-2 py-1 rounded-lg border transition-all ${
                        serverPort === 8989
                          ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 font-bold shadow-sm'
                          : 'bg-slate-900 border-slate-750 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      8989 (Padrão)
                    </button>
                    <button
                      type="button"
                      onClick={() => setServerPort(8080)}
                      className={`text-[11px] font-mono px-2 py-1 rounded-lg border transition-all ${
                        serverPort === 8080
                          ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 font-bold shadow-sm'
                          : 'bg-slate-900 border-slate-750 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      8080
                    </button>
                    <button
                      type="button"
                      onClick={() => setServerPort(9000)}
                      className={`text-[11px] font-mono px-2 py-1 rounded-lg border transition-all ${
                        serverPort === 9000
                          ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 font-bold shadow-sm'
                          : 'bg-slate-900 border-slate-750 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      9000
                    </button>
                  </div>
                </div>
              </div>

              {/* Source Mode Tabs */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-400">Origem dos Arquivos:</span>
                  <span className="text-slate-400">
                    {activeFilesList.length} arquivo(s) prontos ({formatBytes(totalPayloadBytes)})
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 p-1 bg-slate-950/60 rounded-xl border border-slate-800/80">
                  <button
                    onClick={() => setSourceMode('sample')}
                    className={`py-2 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                      sourceMode === 'sample'
                        ? 'bg-cyan-950/70 border border-cyan-500/50 text-cyan-300 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Folder className="h-3.5 w-3.5" />
                    <span>Amostra Rápida</span>
                  </button>

                  <button
                    onClick={() => setSourceMode('uploaded')}
                    className={`py-2 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                      sourceMode === 'uploaded'
                        ? 'bg-cyan-950/70 border border-cyan-500/50 text-cyan-300 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <UploadCloud className="h-3.5 w-3.5" />
                    <span>Seus Arquivos ({uploadedFiles.length})</span>
                  </button>

                  <button
                    onClick={() => setSourceMode('server_folder')}
                    className={`py-2 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                      sourceMode === 'server_folder'
                        ? 'bg-cyan-950/70 border border-cyan-500/50 text-cyan-300 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <HardDrive className="h-3.5 w-3.5" />
                    <span>Pasta no Sistema</span>
                  </button>
                </div>

                {sourceMode === 'server_folder' && (
                  <div className="mt-2">
                    <label className="text-[11px] text-slate-400 block mb-1">Caminho da Pasta de Origem:</label>
                    <input
                      type="text"
                      value={customFolder}
                      onChange={(e) => setCustomFolder(e.target.value)}
                      placeholder="/storage/emulated/0/Download/servidor"
                      className="w-full bg-slate-950/80 border border-slate-700/80 focus:border-cyan-500 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-200 outline-none"
                    />
                  </div>
                )}

                {sourceMode === 'uploaded' && (
                  <div className="mt-2 flex flex-wrap gap-2 items-center">
                    <input
                      type="file"
                      ref={fileInputRef}
                      multiple
                      onChange={(e) => handleFilesChosen(e.target.files)}
                      className="hidden"
                    />
                    <input
                      type="file"
                      ref={folderInputRef}
                      // @ts-ignore
                      webkitdirectory=""
                      directory=""
                      multiple
                      onChange={(e) => handleFilesChosen(e.target.files)}
                      className="hidden"
                    />
                    
                    <button
                      type="button"
                      onClick={() => folderInputRef.current?.click()}
                      disabled={isUploading}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 rounded-lg border border-slate-700 flex items-center gap-1.5 transition-colors"
                    >
                      <Folder className="h-3.5 w-3.5 text-cyan-400" />
                      <span>Selecionar Pasta Completa</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 rounded-lg border border-slate-700 flex items-center gap-1.5 transition-colors"
                    >
                      <FileText className="h-3.5 w-3.5 text-blue-400" />
                      <span>Selecionar Arquivos</span>
                    </button>

                    {uploadedFiles.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setUploadedFiles([])}
                        className="px-2.5 py-1.5 bg-rose-950/40 hover:bg-rose-900/60 text-xs text-rose-300 rounded-lg border border-rose-800/40 flex items-center gap-1 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Limpar</span>
                      </button>
                    )}

                    {isUploading && (
                      <span className="text-xs text-cyan-400 flex items-center gap-1">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Carregando...
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* THE BIG ACTION BUTTON */}
            <div className="lg:col-span-5 flex flex-col justify-center items-center lg:items-end">
              <div className="w-full max-w-sm space-y-3 bg-slate-950/70 p-4 rounded-xl border border-slate-800/90 shadow-inner">
                {/* Banner de Destino em Destaque com Validação */}
                {isFormValid ? (
                  <div className="bg-slate-900 border-2 border-cyan-500/40 rounded-xl p-3 flex items-center justify-between shadow-md">
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${isTransmitting ? 'bg-cyan-400 animate-ping' : transmissionStatus === 'success' ? 'bg-emerald-400' : 'bg-cyan-500'}`} />
                      <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">Destino Alvo:</span>
                    </div>
                    <span className="font-mono text-cyan-300 font-extrabold text-base tracking-wider bg-slate-950 px-2.5 py-1 rounded-lg border border-cyan-800/60 shadow-inner">
                      {serverIp}:{serverPort}
                    </span>
                  </div>
                ) : (
                  <div className="bg-rose-950/30 border-2 border-rose-500/50 rounded-xl p-3 flex items-center justify-between shadow-md">
                    <div className="flex items-center gap-2 text-rose-400">
                      <AlertCircle className="h-4 w-4 shrink-0 animate-bounce" />
                      <span className="text-[11px] font-bold uppercase tracking-wider">Destino Inválido:</span>
                    </div>
                    <span className="font-mono text-rose-300 font-bold text-xs bg-slate-950 px-2.5 py-1 rounded-lg border border-rose-800/80">
                      {!ipValidation.isValid && !portValidation.isValid
                        ? 'IP e Porta incorretos'
                        : !ipValidation.isValid
                        ? 'IP incorreto'
                        : 'Porta incorreta'}
                    </span>
                  </div>
                )}

                {/* BOTÃO PRINCIPAL COM CONTROLE DE VALIDAÇÃO */}
                {!isFormValid ? (
                  <button
                    disabled={true}
                    className="w-full rounded-xl bg-slate-900/90 border-2 border-slate-800 p-4 opacity-60 cursor-not-allowed text-left transition-all shadow-inner"
                    title="Preencha um IP e Porta válidos para habilitar a transmissão"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-slate-800/80 text-rose-400 flex items-center justify-center border border-slate-700">
                        <AlertCircle className="h-5 w-5" />
                      </div>
                      <div className="text-left">
                        <div className="text-sm font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                          TRANSMISSÃO BLOQUEADA
                          <span className="text-[10px] bg-rose-950/90 text-rose-400 border border-rose-800/80 px-1.5 py-0.5 rounded font-mono">
                            Ajuste Necessário
                          </span>
                        </div>
                        <div className="text-[11px] text-rose-400 font-medium">
                          Corrija {!ipValidation.isValid && !portValidation.isValid ? 'o IP e a Porta' : !ipValidation.isValid ? 'o IP do servidor' : 'a Porta'} para habilitar
                        </div>
                      </div>
                    </div>
                  </button>
                ) : !isTransmitting ? (
                  <button
                    onClick={handleExecuteTransmission}
                    className="w-full group relative overflow-hidden rounded-xl bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 p-[2px] transition-all hover:shadow-lg hover:shadow-cyan-500/25 active:scale-[0.98]"
                  >
                    <div className="relative flex items-center justify-center gap-3 rounded-[10px] bg-slate-950/80 px-6 py-4 transition-all group-hover:bg-slate-950/40">
                      <div className="h-10 w-10 rounded-full bg-cyan-500/20 text-cyan-300 flex items-center justify-center border border-cyan-400/40 group-hover:scale-110 transition-transform">
                        <Play className="h-5 w-5 fill-current ml-0.5" />
                      </div>
                      <div className="text-left">
                        <div className="text-sm font-bold uppercase tracking-wider text-white">
                          EXECUTAR TRANSMISSÃO
                        </div>
                        <div className="text-[11px] text-cyan-200">
                          Disparar envio via Socket TCP Java
                        </div>
                      </div>
                    </div>
                  </button>
                ) : (
                  <button
                    onClick={handleAbortTransmission}
                    className="w-full group relative overflow-hidden rounded-xl bg-gradient-to-r from-rose-600 to-red-600 p-[2px] transition-all hover:shadow-lg hover:shadow-rose-500/25 active:scale-[0.98]"
                  >
                    <div className="relative flex items-center justify-center gap-3 rounded-[10px] bg-slate-950/90 px-6 py-4">
                      <Square className="h-6 w-6 text-rose-400 animate-pulse fill-current" />
                      <div className="text-left">
                        <div className="text-sm font-bold uppercase tracking-wider text-white">
                          CANCELAR TRANSMISSÃO
                        </div>
                        <div className="text-[11px] text-rose-300">
                          Interromper socket ativo
                        </div>
                      </div>
                    </div>
                  </button>
                )}

                {/* Test Server Reminder if connecting to 127.0.0.1 or local */}
                {!testServerStatus.running && (serverIp === '127.0.0.1' || serverIp === 'localhost') && (
                  <div className="p-2.5 rounded-lg bg-amber-950/40 border border-amber-500/30 text-[11px] text-amber-200 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      O IP está em 127.0.0.1 mas o <strong>Receptor de Teste</strong> está desligado.{' '}
                      <button
                        onClick={toggleTestServer}
                        className="underline font-semibold hover:text-white"
                      >
                        Clique aqui para ligar o receptor
                      </button>.
                    </div>
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>

        {/* Global Progress Bar (if transmitting or completed) */}
        {currentProgress && (
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between text-xs gap-2">
              <span className="text-slate-300 font-medium flex items-center gap-2">
                <RefreshCw className="h-3.5 w-3.5 text-cyan-400 animate-spin" />
                Enviando Arquivo {currentProgress.fileNum}/{currentProgress.totalFiles}:{' '}
                <span className="font-mono text-cyan-300">{currentProgress.currentFile}</span>
              </span>
              <span className="font-mono text-cyan-400 font-bold">{currentProgress.percentage}%</span>
            </div>

            {/* Custom progress visual */}
            <div className="h-2.5 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 via-blue-500 to-emerald-400 transition-all duration-150"
                style={{ width: `${currentProgress.percentage}%` }}
              />
            </div>

            <div className="flex justify-between items-center text-[11px] text-slate-400 font-mono">
              <span>{currentProgress.bar}</span>
              <span>
                {formatBytes(currentProgress.bytesSent)} de {formatBytes(currentProgress.totalBytes)} enviados
              </span>
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800/80 gap-2 overflow-x-auto pb-px">
          <button
            onClick={() => setActiveTab('terminal')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-all border-b-2 ${
              activeTab === 'terminal'
                ? 'border-cyan-500 text-cyan-300 bg-slate-900/60'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/30'
            }`}
          >
            <TerminalIcon className="h-4 w-4" />
            <span>Terminal CLI em Tempo Real</span>
            {transmissionStatus === 'running' && (
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('receiver')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-all border-b-2 ${
              activeTab === 'receiver'
                ? 'border-emerald-500 text-emerald-300 bg-slate-900/60'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/30'
            }`}
          >
            <Server className="h-4 w-4" />
            <span>Receptor Integrado de Testes</span>
            {testServerStatus.receivedFiles.length > 0 && (
              <span className="px-1.5 py-0.2 bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px] rounded-full">
                {testServerStatus.receivedFiles.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('java_code')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-all border-b-2 ${
              activeTab === 'java_code'
                ? 'border-blue-500 text-blue-300 bg-slate-900/60'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/30'
            }`}
          >
            <FileCode className="h-4 w-4" />
            <span>Código Java & Termux</span>
          </button>

          <button
            onClick={() => setActiveTab('protocol')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-all border-b-2 ${
              activeTab === 'protocol'
                ? 'border-indigo-500 text-indigo-300 bg-slate-900/60'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/30'
            }`}
          >
            <Database className="h-4 w-4" />
            <span>Especificação do Protocolo TCP</span>
          </button>
        </div>

        {/* TAB 1: TERMINAL CLI */}
        {activeTab === 'terminal' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Terminal Window */}
            <div className="lg:col-span-8 bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl flex flex-col h-[520px]">
              {/* Header Bar */}
              <div className="bg-slate-900 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-rose-500/80" />
                    <div className="w-3 h-3 rounded-full bg-amber-500/80" />
                    <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
                  </div>
                  <span className="text-xs font-mono text-slate-400 ml-2">
                    TransmissorArquivos.java &mdash; console
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setAutoScroll(!autoScroll)}
                    className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${
                      autoScroll ? 'bg-cyan-950/80 text-cyan-300 border-cyan-800' : 'text-slate-400 border-slate-800'
                    }`}
                  >
                    Auto-scroll: {autoScroll ? 'ON' : 'OFF'}
                  </button>
                  <button
                    onClick={() => copyCode(terminalLogs.join('\n'), 'code')}
                    className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
                    title="Copiar texto do terminal"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={clearTerminal}
                    className="p-1 text-slate-400 hover:text-rose-400 transition-colors"
                    title="Limpar terminal"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Terminal Content */}
              <div
                ref={terminalEndRef}
                className="flex-1 p-4 font-mono text-xs overflow-y-auto space-y-1 bg-black/40 text-slate-200 leading-relaxed"
              >
                {terminalLogs.length === 0 ? (
                  <div className="text-slate-400 italic">Terminal limpo. Clique em "EXECUTAR TRANSMISSÃO".</div>
                ) : (
                  terminalLogs.map((log, idx) => {
                    const isSuccess = log.includes('TRANSFERÊNCIA CONCLUÍDA') || log.includes('✓ Enviado');
                    const isError = log.includes('ERRO:') || log.includes('Falha');
                    const isHeader = log.includes('=================================') || log.includes('TRANSMISSOR DE ARQUIVOS');
                    const isProgress = log.includes('[') && log.includes(']');
                    const isSeparator = log.includes('---------------------------------');

                    return (
                      <div
                        key={idx}
                        className={`${
                          isSuccess
                            ? 'text-emerald-400 font-bold'
                            : isError
                            ? 'text-rose-400 font-semibold'
                            : isHeader
                            ? 'text-cyan-300 font-bold'
                            : isProgress
                            ? 'text-yellow-400 font-mono'
                            : isSeparator
                            ? 'text-slate-400'
                            : 'text-slate-300'
                        }`}
                      >
                        {log}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Status footer */}
              <div className="bg-slate-900/80 px-4 py-2 border-t border-slate-800 text-[11px] font-mono text-slate-400 flex items-center justify-between">
                <span>Alvo: {serverIp}:{serverPort}</span>
                <span className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${isTransmitting ? 'bg-cyan-400 animate-ping' : 'bg-slate-500'}`} />
                  {isTransmitting ? 'Conexão aberta' : 'Conexão fechada'}
                </span>
              </div>
            </div>

            {/* Right side: File queue & payload details */}
            <div className="lg:col-span-4 space-y-4">
              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                    <Folder className="h-4 w-4 text-cyan-400" />
                    Fila de Arquivos ({activeFilesList.length})
                  </h3>
                  <span className="text-[11px] font-mono text-cyan-400">
                    {formatBytes(totalPayloadBytes)}
                  </span>
                </div>

                <div className="max-h-[360px] overflow-y-auto space-y-1.5 pr-1">
                  {activeFilesList.length === 0 ? (
                    <div className="text-center py-8 text-xs text-slate-400">
                      Nenhum arquivo na fila. Selecione uma pasta ou use a amostra rápida.
                    </div>
                  ) : (
                    activeFilesList.map((file, idx) => (
                      <div
                        key={idx}
                        className="p-2 rounded-lg bg-slate-950/70 border border-slate-800/80 hover:border-slate-700 transition-colors flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          <FileText className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                          <div className="truncate">
                            <p className="text-xs font-mono text-slate-200 truncate">{file.relativePath}</p>
                            <p className="text-[10px] text-slate-400">{file.sizeFormatted || formatBytes(file.size)}</p>
                          </div>
                        </div>

                        {sourceMode === 'uploaded' && (
                          <button
                            onClick={() => {
                              setUploadedFiles(prev => prev.filter((_, i) => i !== idx));
                            }}
                            className="text-slate-400 hover:text-rose-400 p-1"
                            title="Remover arquivo"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
                  <span>Modo atual:</span>
                  <span className="font-semibold text-slate-300">
                    {sourceMode === 'sample' ? 'Amostra Demo' : sourceMode === 'uploaded' ? 'Upload Manual' : 'Pasta Local'}
                  </span>
                </div>
              </div>

              {/* Fast Tips Card */}
              <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-4 space-y-2 text-xs text-slate-400">
                <div className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  Como funciona este comando?
                </div>
                <p className="leading-relaxed">
                  Ao clicar em <strong>EXECUTAR TRANSMISSÃO</strong>, a aplicação abre um socket TCP nativo em direção a <code className="text-cyan-300 font-mono">{serverIp}:{serverPort}</code> e transmite o lote de arquivos através da especificação binária exata do Java <code className="text-slate-300">DataOutputStream</code>.
                </p>
                <p className="text-[11px] text-slate-400">
                  Se o celular receptor estiver na mesma rede Wi-Fi, a transferência ocorre em velocidade máxima de rede local sem limites de tamanho.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: RECEPTOR INTEGRADO */}
        {activeTab === 'receiver' && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Server className="h-5 w-5 text-emerald-400" />
                    Servidor Receptor de Testes (TCP Socket)
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Permite testar o envio sem precisar de um segundo celular ou dispositivo externo agora.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 text-xs">
                    <label className="text-slate-400">Porta de Escuta:</label>
                    <input
                      type="number"
                      value={testServerPortInput}
                      onChange={(e) => setTestServerPortInput(Number(e.target.value))}
                      disabled={testServerStatus.running}
                      className="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-cyan-300 text-xs"
                    />
                  </div>

                  <button
                    onClick={toggleTestServer}
                    disabled={testServerBusy}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-md flex items-center gap-2 ${
                      testServerStatus.running
                        ? 'bg-rose-600 hover:bg-rose-700 text-white'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    }`}
                  >
                    {testServerStatus.running ? (
                      <>
                        <Square className="h-3.5 w-3.5 fill-current" />
                        <span>Parar Servidor Receptor</span>
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5 fill-current" />
                        <span>Iniciar Servidor Receptor</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {testServerStatus.running && (
                <div className="p-3 bg-emerald-950/40 border border-emerald-500/30 rounded-lg flex items-center justify-between text-xs text-emerald-200">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>
                      Servidor escutando ativamente na porta <strong>{testServerStatus.port}</strong>.
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setServerIp('127.0.0.1');
                      setServerPort(testServerStatus.port);
                      setActiveTab('terminal');
                    }}
                    className="px-2.5 py-1 bg-emerald-800/60 hover:bg-emerald-800 rounded font-semibold text-white transition-colors"
                  >
                    Usar 127.0.0.1:{testServerStatus.port} no Transmissor
                  </button>
                </div>
              )}
            </div>

            {/* Received Files Table */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    Arquivos Recebidos pelo Servidor ({testServerStatus.receivedFiles.length})
                  </h4>
                  {testServerStatus.receivedFiles.length > 0 && (
                    <button
                      onClick={handleClearTestServer}
                      className="text-[11px] text-slate-400 hover:text-rose-400 transition-colors"
                    >
                      Limpar lista
                    </button>
                  )}
                </div>

                <div className="max-h-[340px] overflow-y-auto space-y-2">
                  {testServerStatus.receivedFiles.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-400">
                      Nenhum arquivo recebido ainda.{' '}
                      {testServerStatus.running
                        ? 'Execute a transmissão apontando para 127.0.0.1 para ver os arquivos chegarem!'
                        : 'Inicie o receptor acima para começar.'}
                    </div>
                  ) : (
                    testServerStatus.receivedFiles.map((file, idx) => (
                      <div
                        key={idx}
                        className="p-3 bg-slate-950/70 border border-slate-800 rounded-lg flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-mono font-medium text-emerald-300 truncate">{file.name}</p>
                          <p className="text-[10px] text-slate-400">
                            {formatBytes(file.size)} &bull; Recebido às {file.receivedAt}
                          </p>
                        </div>

                        <a
                          href={`/api/test-server/download/${encodeURIComponent(file.path)}`}
                          download
                          className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs text-cyan-300 rounded flex items-center gap-1 transition-colors shrink-0"
                          title="Baixar arquivo recebido para inspecionar integridade"
                        >
                          <Download className="h-3 w-3" />
                          <span>Baixar</span>
                        </a>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Receiver Log */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col h-[380px]">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <span className="text-xs font-mono text-slate-400">Log do Socket Receptor</span>
                  <span className="text-[10px] text-slate-400">{testServerStatus.logs.length} eventos</span>
                </div>

                <div className="flex-1 overflow-y-auto py-2 font-mono text-[11px] text-slate-300 space-y-1">
                  {testServerStatus.logs.length === 0 ? (
                    <div className="text-slate-400 italic">Nenhum evento registrado.</div>
                  ) : (
                    testServerStatus.logs.map((log, idx) => (
                      <div key={idx} className="text-slate-300">
                        {log}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: CÓDIGO JAVA ORIGINAL & TERMUX */}
        {activeTab === 'java_code' && (
          <div className="space-y-6">
            {/* Quick Android / Termux guide */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Smartphone className="h-5 w-5 text-cyan-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Como Executar no Celular Android via Termux
                </h3>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                Se você deseja executar o código Java diretamente no seu smartphone Android sem computador, utilize o <strong>Termux</strong> com os seguintes comandos:
              </p>

              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-xs text-cyan-300 flex items-center justify-between gap-4 overflow-x-auto">
                <code>
                  pkg update && pkg install openjdk-17 -y && termux-setup-storage && javac TransmissorArquivos.java && java TransmissorArquivos
                </code>
                <button
                  onClick={() => copyCode('pkg update && pkg install openjdk-17 -y && termux-setup-storage && javac TransmissorArquivos.java && java TransmissorArquivos', 'termux')}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs flex items-center gap-1 shrink-0 transition-colors"
                >
                  {copiedTermux ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedTermux ? 'Copiado!' : 'Copiar Comando'}</span>
                </button>
              </div>
            </div>

            {/* Java Code View */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
              <div className="bg-slate-900 px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Code2 className="h-4 w-4 text-cyan-400" />
                  <span className="font-mono text-xs font-semibold text-slate-200">
                    TransmissorArquivos.java (Com seus dados configurados)
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => copyCode(generatedJavaCode, 'code')}
                    className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs flex items-center gap-1.5 transition-colors"
                  >
                    {copiedCode ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedCode ? 'Copiado!' : 'Copiar Código'}</span>
                  </button>

                  <button
                    onClick={downloadJavaFile}
                    className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs flex items-center gap-1.5 font-medium transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Baixar .java</span>
                  </button>
                </div>
              </div>

              <pre className="p-4 font-mono text-xs text-slate-300 overflow-x-auto max-h-[500px] leading-relaxed bg-black/50">
                <code>{generatedJavaCode}</code>
              </pre>
            </div>

            {/* Complementary Receiver Code in Java */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
              <div className="bg-slate-900 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-emerald-400" />
                  <span className="font-mono text-xs font-semibold text-slate-200">
                    ReceptorArquivos.java (Código do Servidor Receptor para rodar no outro dispositivo)
                  </span>
                </div>

                <button
                  onClick={() => copyCode(javaReceiverCode, 'code')}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs flex items-center gap-1.5 transition-colors"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copiar Código do Receptor</span>
                </button>
              </div>

              <pre className="p-4 font-mono text-xs text-slate-300 overflow-x-auto max-h-[400px] leading-relaxed bg-black/50">
                <code>{javaReceiverCode}</code>
              </pre>
            </div>
          </div>
        )}

        {/* TAB 4: PROTOCOLO TCP */}
        {activeTab === 'protocol' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Radio className="h-4 w-4 text-cyan-400" />
                Estrutura dos Pacotes Binários no Socket
              </h3>

              <div className="space-y-3 text-xs text-slate-300">
                <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 space-y-1">
                  <span className="font-mono font-bold text-cyan-400">1. Cabeçalho Inicial: Quantidade de Arquivos</span>
                  <p className="text-slate-400">
                    O transmissor envia <code className="text-slate-200">saida.writeInt(arquivos.size())</code> (4 bytes Big-Endian).
                  </p>
                </div>

                <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 space-y-1">
                  <span className="font-mono font-bold text-cyan-400">2. Metadados do Arquivo</span>
                  <p className="text-slate-400">
                    - <code className="text-slate-200">saida.writeUTF(relativo)</code>: 2 bytes de comprimento + caracteres UTF-8.
                    <br />
                    - <code className="text-slate-200">saida.writeLong(tamanho)</code>: 8 bytes Big-Endian com o tamanho em bytes.
                  </p>
                </div>

                <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 space-y-1">
                  <span className="font-mono font-bold text-cyan-400">3. Transmissão do Conteúdo</span>
                  <p className="text-slate-400">
                    Os bytes brutos do arquivo são transmitidos sequencialmente em blocos de até <code className="text-slate-200">8192 bytes</code>.
                  </p>
                </div>

                <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 space-y-1">
                  <span className="font-mono font-bold text-cyan-400">4. Confirmação do Servidor</span>
                  <p className="text-slate-400">
                    O receptor responde via <code className="text-slate-200">saida.writeUTF("OK")</code>, que o transmissor lê com <code className="text-slate-200">entrada.readUTF()</code>.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                Vantagens Desta Abordagem
              </h3>

              <ul className="space-y-2.5 text-xs text-slate-300">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span><strong>Zero Overhead HTTP:</strong> Conexão TCP pura e contínua, atingindo a velocidade máxima física do Wi-Fi/Ethernet.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span><strong>Preservação de Pastas:</strong> Envia caminhos relativos para recriar exatamente a estrutura de diretórios no receptor.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span><strong>Suporte Nativo Android:</strong> Compatível tanto com Java puro, Android Studio, Termux e navegadores web.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span><strong>Confirmação de Integridade:</strong> Apenas conclui com êxito se o servidor confirmar o recebimento integral de todos os arquivos.</span>
                </li>
              </ul>
            </div>
          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950 py-4 px-4 text-center text-xs text-slate-400">
        <p>Transmissor de Arquivos TCP Socket &bull; Baseado no código Java DataOutputStream / DataInputStream</p>
      </footer>
    </div>
  );
}
