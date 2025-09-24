'use client';

import React, { useCallback, useState } from 'react';
import { Upload, File, X, AlertCircle } from 'lucide-react';

interface UploadedFile {
  file: File;
  url: string;
  name: string;
}

interface PdfUploaderProps {
  onFileUpload: (file: File) => void;
  uploadedFile: UploadedFile | null;
  placeholder: string;
}

const PdfUploader: React.FC<PdfUploaderProps> = ({ 
  onFileUpload, 
  uploadedFile, 
  placeholder 
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validateFile = (file: File): boolean => {
    if (file.type !== 'application/pdf') {
      setError('Seuls les fichiers PDF sont acceptés');
      return false;
    }
    
    if (file.size > 10 * 1024 * 1024) { // 10MB limit
      setError('La taille du fichier ne doit pas dépasser 10MB');
      return false;
    }
    
    setError(null);
    return true;
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    const file = files[0];
    
    if (file && validateFile(file)) {
      onFileUpload(file);
    }
  }, [onFileUpload]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && validateFile(file)) {
      onFileUpload(file);
    }
  }, [onFileUpload]);

  const removeFile = useCallback(() => {
    if (uploadedFile?.url) {
      URL.revokeObjectURL(uploadedFile.url);
    }
    setError(null);
  }, [uploadedFile]);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-3">
      {!uploadedFile ? (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-all duration-200 cursor-pointer hover:scale-[1.02] ${
            isDragOver 
              ? 'border-blue-400 bg-blue-50' 
              : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'
          }`}
        >
          <input
            type="file"
            accept=".pdf"
            onChange={handleFileInput}
            className="hidden"
            id={`pdf-input-${placeholder}`}
          />
          <label htmlFor={`pdf-input-${placeholder}`} className="cursor-pointer block">
            <Upload className={`w-12 h-12 mx-auto mb-4 transition-colors ${
              isDragOver ? 'text-blue-500' : 'text-gray-400'
            }`} />
            <p className="text-lg font-medium text-gray-700 mb-2">
              {placeholder}
            </p>
            <p className="text-sm text-gray-500">
              ou cliquez pour sélectionner un fichier PDF (max 10MB)
            </p>
          </label>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3 flex-1 min-w-0">
              <div className="bg-red-100 p-2 rounded">
                <File className="w-5 h-5 text-red-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">
                  {uploadedFile.name}
                </p>
                <p className="text-sm text-gray-500">
                  {formatFileSize(uploadedFile.file.size)}
                </p>
              </div>
            </div>
            <button
              onClick={removeFile}
              className="p-1 hover:bg-gray-100 rounded-full transition-colors"
              title="Supprimer le fichier"
            >
              <X className="w-4 h-4 text-gray-400 hover:text-gray-600" />
            </button>
          </div>
        </div>
      )}
      
      {error && (
        <div className="flex items-center space-x-2 text-red-600 bg-red-50 p-3 rounded-lg">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}
    </div>
  );
};

export default PdfUploader;