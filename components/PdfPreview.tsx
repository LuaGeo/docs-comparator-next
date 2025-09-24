"use client";

import React, { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Eye, AlertCircle } from "lucide-react";

interface UploadedFile {
  file: File;
  url: string;
  name: string;
}

interface PdfPreviewProps {
  file: UploadedFile | null;
  title: string;
}

const PdfPreview: React.FC<PdfPreviewProps> = ({ file, title }) => {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<any>(null);
  const pdfDocRef = useRef<any>(null);

  const renderPage = async (pageNum: number) => {
    if (!pdfDocRef.current || !canvasRef.current) return;

    try {
      setLoading(true);

      // Cancel any ongoing render task
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }

      const page = await pdfDocRef.current.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.5 });

      const canvas = canvasRef.current;
      const canvasContext = canvas.getContext("2d");

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderContext = { canvasContext, viewport };
      const renderTask = page.render(renderContext);
      renderTaskRef.current = renderTask;

      await renderTask.promise;
      setLoading(false);
    } catch (error: any) {
      if (error.name === "RenderingCancelledException") {
        console.log("Rendering cancelled.");
      } else {
        console.error("Render error:", error);
        setError("Erreur lors du rendu de la page");
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    let isCancelled = false;

    if (!file) {
      setNumPages(0);
      setPageNumber(1);
      setError(null);
      return;
    }

    (async function () {
      try {
        setLoading(true);
        setError(null);

        // Import pdfjs-dist dynamically for client-side rendering
        const pdfJS = await import("pdfjs-dist/webpack");

        // Set up the worker
        pdfJS.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfJS.version}/pdf.worker.min.js`;

        // Load the PDF document from the file
        const arrayBuffer = await file.file.arrayBuffer();
        const pdf = await pdfJS.getDocument({ data: arrayBuffer }).promise;

        if (isCancelled) return;

        pdfDocRef.current = pdf;
        setNumPages(pdf.numPages);
        setPageNumber(1);

        // Render the first page
        await renderPage(1);
      } catch (err) {
        if (!isCancelled) {
          setError("Erreur lors du chargement du PDF");
          setLoading(false);
        }
      }
    })();

    return () => {
      isCancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
    };
  }, [file]);

  // Handle page navigation
  useEffect(() => {
    if (pdfDocRef.current && pageNumber > 0) {
      renderPage(pageNumber);
    }
  }, [pageNumber]);

  const goToPrevPage = () => {
    setPageNumber((page) => Math.max(1, page - 1));
  };

  const goToNextPage = () => {
    setPageNumber((page) => Math.min(numPages, page + 1));
  };

  if (!file) {
    return (
      <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
        <Eye className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <p className="text-gray-500">{title} - En attente du fichier</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="p-4 border-b border-gray-200">
        <h3 className="font-semibold text-gray-900 flex items-center">
          <Eye className="w-5 h-5 mr-2 text-blue-600" />
          {title}
        </h3>
        <p className="text-sm text-gray-600 truncate mt-1">{file.name}</p>
      </div>

      <div className="p-4">
        {error ? (
          <div className="flex items-center justify-center h-64 bg-red-50 rounded-lg">
            <div className="text-center">
              <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
              <p className="text-red-600">{error}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-center">
              <div className="border border-gray-200 rounded-lg overflow-hidden shadow-sm relative">
                {loading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  </div>
                )}
                <canvas
                  ref={canvasRef}
                  style={{
                    maxWidth: "300px",
                    height: "auto",
                    display: loading ? "none" : "block",
                  }}
                />
              </div>
            </div>

            {numPages > 1 && (
              <div className="flex items-center justify-center space-x-4">
                <button
                  onClick={goToPrevPage}
                  disabled={pageNumber <= 1 || loading}
                  className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <span className="text-sm text-gray-600 min-w-0">
                  Page {pageNumber} sur {numPages}
                </span>

                <button
                  onClick={goToNextPage}
                  disabled={pageNumber >= numPages || loading}
                  className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PdfPreview;
