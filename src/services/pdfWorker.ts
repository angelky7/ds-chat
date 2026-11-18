/**
 * PDF.js worker 入口：rspack 把它打成独立 worker chunk，只在第一次解析 PDF 时加载。
 * 主线程通过 GlobalWorkerOptions.workerPort 指向由这里创建的 Worker。
 */
import 'pdfjs-dist/build/pdf.worker.min.mjs'
