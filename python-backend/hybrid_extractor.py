import fitz  # PyMuPDF
from google.cloud import vision
import io
from PIL import Image
import os
from dotenv import load_dotenv

load_dotenv()

class HybridPDFExtractor:
    """
    Extracteur hybride : texte direct du PDF + OCR pour les images
    """
    
    def __init__(self, vision_client=None):
        self.vision_client = vision_client or vision.ImageAnnotatorClient()
    
    def has_extractable_text(self, page):
        """
        Vérifie si la page contient du texte extractible
        """
        text = page.get_text().strip()
        return len(text) > 50  # Seuil : minimum de caractères
    
    def has_images(self, page):
        """
        Vérifie si la page contient des images
        """
        image_list = page.get_images()
        return len(image_list) > 0
    
    def extract_text_from_pdf(self, page):
        """
        Extrait le texte directement du PDF (rapide et gratuit)
        """
        return page.get_text()
    
    def extract_text_from_image_ocr(self, page, page_num):
        """
        Extrait le texte en utilisant l'OCR (pour les pages avec images/tableaux)
        """
        # Convertir la page en image à haute résolution
        mat = fitz.Matrix(3, 3)  # Zoom 3x
        pix = page.get_pixmap(matrix=mat)
        img_bytes = pix.tobytes("png")
        
        # OCR avec Google Cloud Vision
        image = vision.Image(content=img_bytes)
        response = self.vision_client.document_text_detection(image=image)
        
        if response.error.message:
            raise Exception(f'Erreur OCR: {response.error.message}')
        
        # Extraire le texte
        text = response.full_text_annotation.text if response.full_text_annotation else ""
        
        return text
    
    def extract_from_pdf(self, pdf_path, output_path=None):
        """
        Traite le PDF page par page en décidant de la meilleure stratégie
        """
        doc = fitz.open(pdf_path)
        
        results = []
        stats = {
            'total_pages': len(doc),
            'text_extracted': 0,
            'ocr_used': 0,
            'hybrid': 0,
            'empty': 0
        }
        
        print(f"📄 Traitement de {len(doc)} pages...\n")
        
        for page_num in range(len(doc)):
            page = doc[page_num]
            page_data = {
                'page_number': page_num + 1,
                'text': '',
                'method': '',
                'has_images': False
            }
            
            # Vérifier s'il y a du texte extractible
            has_text = self.has_extractable_text(page)
            has_imgs = self.has_images(page)
            
            page_data['has_images'] = has_imgs
            
            # Décision : quelle méthode utiliser ?
            if has_text and not has_imgs:
                # Cas 1 : Seulement du texte → extraction directe (RAPIDE)
                page_data['text'] = self.extract_text_from_pdf(page)
                page_data['method'] = 'direct_text'
                stats['text_extracted'] += 1
                print(f"✓ Page {page_num + 1} : Texte direct")
                
            elif has_imgs and not has_text:
                # Cas 2 : Seulement des images → OCR complet
                print(f"🔍 Page {page_num + 1} : Utilisation de l'OCR (images détectées)...")
                page_data['text'] = self.extract_text_from_image_ocr(page, page_num)
                page_data['method'] = 'ocr_only'
                stats['ocr_used'] += 1
                
            elif has_text and has_imgs:
                # Cas 3 : HYBRIDE - texte + images → combiner les deux
                print(f"🔀 Page {page_num + 1} : Mode hybride (texte + images)...")
                
                # Extraire le texte direct
                direct_text = self.extract_text_from_pdf(page)
                
                # Extraire le texte des images via OCR
                ocr_text = self.extract_text_from_image_ocr(page, page_num)
                
                # Combiner intelligemment
                page_data['text'] = self.merge_text_and_ocr(direct_text, ocr_text)
                page_data['method'] = 'hybrid'
                stats['hybrid'] += 1
                
            else:
                # Cas 4 : Page vide
                page_data['text'] = ""
                page_data['method'] = 'empty'
                stats['empty'] += 1
                print(f"⚠️  Page {page_num + 1} : Vide")
            
            results.append(page_data)
        
        doc.close()
        
        # Assembler le texte complet dans l'ordre
        full_text = self.assemble_full_text(results)
        
        # Sauvegarder si nécessaire
        if output_path:
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(full_text)
            print(f"\n✓ Texte complet sauvegardé dans : {output_path}")
        
        # Statistiques
        print("\n" + "="*60)
        print("📊 STATISTIQUES")
        print("="*60)
        print(f"Total de pages : {stats['total_pages']}")
        print(f"Texte direct : {stats['text_extracted']} pages")
        print(f"OCR utilisé : {stats['ocr_used']} pages")
        print(f"Mode hybride : {stats['hybrid']} pages")
        print(f"Pages vides : {stats['empty']} pages")
        print(f"\n💰 Coût estimé OCR : ${(stats['ocr_used'] + stats['hybrid']) * 0.0015:.2f}")
        
        return full_text, results, stats
    
    def merge_text_and_ocr(self, direct_text, ocr_text):
        """
        Combine le texte direct avec le texte de l'OCR de manière intelligente
        """
        # Stratégie : garder le texte direct et ajouter le contenu de l'OCR qui n'est pas présent
        
        # Diviser en lignes
        direct_lines = set(line.strip() for line in direct_text.split('\n') if line.strip())
        ocr_lines = [line.strip() for line in ocr_text.split('\n') if line.strip()]
        
        # Ajouter les lignes de l'OCR qui ne sont pas dans le texte direct
        additional_lines = []
        for ocr_line in ocr_lines:
            # Vérifier si la ligne OCR existe déjà dans le texte direct
            if not any(ocr_line in direct_line or direct_line in ocr_line 
                    for direct_line in direct_lines):
                additional_lines.append(ocr_line)
        
        # Combiner
        if additional_lines:
            combined = direct_text + "\n\n[CONTENU DES IMAGES/TABLEAUX]\n" + "\n".join(additional_lines)
        else:
            combined = direct_text
        
        return combined
    
    def assemble_full_text(self, results):
        """
        Assemble le texte complet en maintenant l'ordre des pages
        """
        full_text_parts = []
        
        for page_data in results:
            page_num = page_data['page_number']
            text = page_data['text'].strip()
            
            if text:
                # Ajouter un séparateur de page
                separator = f"\n\n{'='*60}\n[PAGE {page_num}]\n{'='*60}\n\n"
                full_text_parts.append(separator + text)
        
        return "\n".join(full_text_parts)


# ============================================
# EXEMPLE D'UTILISATION
# ============================================

def main():
    # Configurer Google Cloud Vision
    # Assurez-vous d'avoir la variable d'environnement GOOGLE_APPLICATION_CREDENTIALS configurée
    # export GOOGLE_APPLICATION_CREDENTIALS="chemin/vers/credentials.json"
    
    extractor = HybridPDFExtractor()
    
    # Traiter le PDF
    pdf_path = "C:\\Users\\DEOLIVEIRALuana\\dev\\projects\\diff-pdf\\img\\Contrat CP_CG SAFRAN 2024 Anciens salariés Gtie Resp V_7EL.pdf"
    output_path = "texte_extrait_complet.txt"
    
    full_text, page_results, stats = extractor.extract_from_pdf(
        pdf_path, 
        output_path
    )
    
    # Voir les résultats
    print("\n" + "="*60)
    print("📝 PREMIERS 500 CARACTÈRES DU TEXTE EXTRAIT")
    print("="*60)
    print(full_text[:500])
    print("...")
    
    # Sauvegarder aussi en JSON (avec métadonnées)
    import json
    json_output = "texte_extrait_metadata.json"
    with open(json_output, 'w', encoding='utf-8') as f:
        json.dump({
            'stats': stats,
            'pages': page_results,
            'full_text': full_text
        }, f, ensure_ascii=False, indent=2)
    
    print(f"\n✓ Métadonnées sauvegardées dans : {json_output}")


if __name__ == "__main__":
    main()