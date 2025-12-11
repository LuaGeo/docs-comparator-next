from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import tempfile
import os
import re
import difflib
from hybrid_extractor import HybridPDFExtractor
from google.cloud import vision

app = FastAPI(title="PDF Comparator API")

# CORS para permitir requisições do Next.js
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Inicializar o extrator
try:
    vision_client = vision.ImageAnnotatorClient()
except Exception as e:
    print(f"⚠️ Vision API non disponible: {e}")
    vision_client = None

extractor = HybridPDFExtractor(vision_client=vision_client)


def clean_text_advanced(text: str) -> str:
    """
    Nettoie le texte extrait d'un PDF pour enlever les artefacts courants.
    IDENTIQUE à la version Streamlit pour des résultats cohérents.
    """
    cleaned_lines = []
    for line in text.splitlines():
        stripped_line = line.strip()
        # Ignorer les lignes qui sont uniquement des numéros ou trop courtes
        if not re.fullmatch(r'\d+', stripped_line) and len(stripped_line) > 2:
            # Normaliser les espaces
            normalized_line = re.sub(r'\s+', ' ', stripped_line)
            cleaned_lines.append(normalized_line)
    return "\n".join(cleaned_lines)


@app.get("/")
def read_root():
    return {
        "message": "PDF Comparator API",
        "version": "1.0.0",
        "endpoints": {
            "/api/extract": "POST - Extract text from a single PDF",
            "/api/compare": "POST - Compare two PDFs and return text + stats",
            "/api/compare-html": "POST - Compare two PDFs and return HTML diff (like Streamlit)",
        }
    }


@app.post("/api/extract")
async def extract_pdf(file: UploadFile = File(...)):
    """
    Extrai texto de um único PDF usando o método híbrido (texto direto + OCR)
    """
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")
    
    with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp_file:
        content = await file.read()
        tmp_file.write(content)
        tmp_path = tmp_file.name
    
    try:
        full_text, page_results, stats = extractor.extract_from_pdf(tmp_path)
        full_text = clean_text_advanced(full_text)
        
        return JSONResponse(content={
            "success": True,
            "filename": file.filename,
            "text": full_text,
            "pages": page_results,
            "stats": stats
        })
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing PDF: {str(e)}")
    
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


@app.post("/api/compare")
async def compare_pdfs(
    file1: UploadFile = File(...),
    file2: UploadFile = File(...)
):
    """
    Compara dois PDFs e retorna:
    - Texto extraído de cada um (nettoyé)
    - Metadados (páginas processadas, métodos usados)
    - Estatísticas de processamento
    """
    if not file1.filename.endswith('.pdf') or not file2.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")
    
    with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp1:
        content1 = await file1.read()
        tmp1.write(content1)
        tmp1_path = tmp1.name
    
    with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp2:
        content2 = await file2.read()
        tmp2.write(content2)
        tmp2_path = tmp2.name
    
    try:
        print(f"🔍 Extracting text from {file1.filename}...")
        text1, pages1, stats1 = extractor.extract_from_pdf(tmp1_path)
        
        print(f"🔍 Extracting text from {file2.filename}...")
        text2, pages2, stats2 = extractor.extract_from_pdf(tmp2_path)
        
        text1 = clean_text_advanced(text1)
        text2 = clean_text_advanced(text2)
        
        return JSONResponse(content={
            "success": True,
            "file1": {
                "filename": file1.filename,
                "text": text1,
                "pages": pages1,
                "stats": stats1
            },
            "file2": {
                "filename": file2.filename,
                "text": text2,
                "pages": pages2,
                "stats": stats2
            }
        })
    
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Error comparing PDFs: {str(e)}"
        )
    
    finally:
        if os.path.exists(tmp1_path):
            os.unlink(tmp1_path)
        if os.path.exists(tmp2_path):
            os.unlink(tmp2_path)


@app.post("/api/compare-html")
async def compare_pdfs_html(
    file1: UploadFile = File(...),
    file2: UploadFile = File(...)
):
    """
    Compare deux PDFs et retourne un diff HTML identique à Streamlit.
    Utilise difflib.HtmlDiff pour un rendu côte à côte optimisé.
    """
    if not file1.filename.endswith('.pdf') or not file2.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")
    
    with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp1:
        content1 = await file1.read()
        tmp1.write(content1)
        tmp1_path = tmp1.name
    
    with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp2:
        content2 = await file2.read()
        tmp2.write(content2)
        tmp2_path = tmp2.name
    
    try:
        print(f"🔍 Extracting text from {file1.filename}...")
        text1, pages1, stats1 = extractor.extract_from_pdf(tmp1_path)
        
        print(f"🔍 Extracting text from {file2.filename}...")
        text2, pages2, stats2 = extractor.extract_from_pdf(tmp2_path)
        
        # Nettoyer le texte comme Streamlit
        text1 = clean_text_advanced(text1)
        text2 = clean_text_advanced(text2)
        
        # Générer le diff HTML avec difflib (IDENTIQUE à Streamlit)
        lines1 = text1.splitlines()
        lines2 = text2.splitlines()
        
        html_diff = difflib.HtmlDiff(wrapcolumn=80).make_file(
            lines1,
            lines2,
            fromdesc=f"{file1.filename} (contenu complet)",
            todesc=f"{file2.filename} (contenu complet)"
        )
        
        # Calculer les statistiques de coût
        total_ocr_pages = (
            stats1['ocr_used'] + stats1['hybrid'] + 
            stats2['ocr_used'] + stats2['hybrid']
        )
        total_cost = total_ocr_pages * 0.0015
        
        # Vérifier si les documents sont identiques
        is_identical = text1.strip() == text2.strip()
        
        return JSONResponse(content={
            "success": True,
            "html": html_diff,
            "is_identical": is_identical,
            "text1": text1,  # Texte nettoyé pour le PDF annoté
            "text2": text2,  # Texte nettoyé pour le PDF annoté
            "stats": {
                "file1": stats1,
                "file2": stats2,
                "total_pages": stats1['total_pages'] + stats2['total_pages'],
                "total_ocr_pages": total_ocr_pages,
                "estimated_cost": f"${total_cost:.4f}"
            }
        })
    
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Error comparing PDFs: {str(e)}"
        )
    
    finally:
        if os.path.exists(tmp1_path):
            os.unlink(tmp1_path)
        if os.path.exists(tmp2_path):
            os.unlink(tmp2_path)


@app.get("/health")
def health_check():
    """Verificar se a API está funcionando"""
    return {"status": "healthy", "service": "pdf-comparator-api"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
