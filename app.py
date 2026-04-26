from flask import Flask, render_template, request, jsonify
from werkzeug.utils import secure_filename
from clustering import cluster_documents
import io
import csv
import json

try:
    from pypdf import PdfReader
except ImportError:
    PdfReader = None

try:
    import docx
except ImportError:
    docx = None

try:
    import fitz # PyMuPDF
except ImportError:
    fitz = None

import pytesseract
from PIL import Image
import concurrent.futures
import os

app = Flask(__name__)

def extract_text(filename, file_bytes):
    text = ""
    try:
        if filename.endswith('.txt'):
            text = file_bytes.decode('utf-8', errors='ignore')
        elif filename.endswith('.csv'):
            content = file_bytes.decode('utf-8', errors='ignore')
            reader = csv.reader(io.StringIO(content))
            lines = [" ".join(row) for row in reader]
            text = "\n".join(lines)
        elif filename.endswith('.pdf'):
            if fitz:
                try:
                    doc = fitz.open(stream=file_bytes, filetype="pdf")
                    for page in doc:
                        text += page.get_text() + "\n"
                        # Extract images from page
                        for img_info in page.get_images(full=True):
                            xref = img_info[0]
                            try:
                                base_image = doc.extract_image(xref)
                                image_bytes = base_image["image"]
                                pil_img = Image.open(io.BytesIO(image_bytes))
                                # Resize to speed up OCR and prevent memory issues
                                pil_img.thumbnail((1200, 1200))
                                ocr_text = pytesseract.image_to_string(pil_img)
                                if ocr_text: text += ocr_text + "\n"
                            except Exception as img_e:
                                print(f"Error processing image {xref} in PDF: {img_e}")
                except Exception as e:
                    print(f"PyMuPDF error: {e}")
            elif PdfReader:
                reader = PdfReader(io.BytesIO(file_bytes))
                for page in reader.pages:
                    extracted = page.extract_text()
                    if extracted: text += extracted + "\n"
        elif filename.endswith('.docx') and docx:
            doc = docx.Document(io.BytesIO(file_bytes))
            for para in doc.paragraphs:
                text += para.text + "\n"
            for rel in doc.part.rels.values():
                if "image" in rel.target_ref:
                    try:
                        image_data = rel.target_part.blob
                        pil_img = Image.open(io.BytesIO(image_data))
                        pil_img.thumbnail((1200, 1200))
                        ocr_text = pytesseract.image_to_string(pil_img)
                        if ocr_text: text += ocr_text + "\n"
                    except Exception as e:
                        print(f"Error OCR on DOCX image: {e}")
        elif filename.endswith(('.png', '.jpg', '.jpeg', '.bmp', '.tiff')):
            try:
                pil_img = Image.open(io.BytesIO(file_bytes))
                pil_img.thumbnail((1600, 1600))
                text = pytesseract.image_to_string(pil_img)
            except Exception as e:
                print(f"Error OCR on standalone image: {e}")
    except Exception as e:
        print(f"Error reading {filename}: {e}")
    return text.strip()

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/cluster', methods=['POST'])
def cluster():
    try:
        documents = []
        
        # 1. Parse JSON payload of raw pasted documents
        raw_text_json = request.form.get('raw_documents', '[]')
        try:
            raw_docs = json.loads(raw_text_json)
            for i, d in enumerate(raw_docs):
                documents.append({"title": f"Pasted Text {i+1}", "text": d})
        except:
            pass
                
        # 2. Parse file uploads concurrently
        if 'files' in request.files:
            files = request.files.getlist('files')
            file_paths_json = request.form.get('file_paths', '[]')
            try:
                file_paths = json.loads(file_paths_json)
            except:
                file_paths = []
            
            file_data_list = []
            for i, f in enumerate(files):
                if f.filename:
                    fname = secure_filename(f.filename).lower()
                    path = file_paths[i] if i < len(file_paths) else f.filename
                    file_data_list.append((fname, f.read(), f.filename, path)) 
                    
            # Cap max_workers
            max_workers = min(4, os.cpu_count() or 1)
            with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
                future_to_file = {executor.submit(extract_text, fname, fbytes): (orig_fname, path) for fname, fbytes, orig_fname, path in file_data_list}
                for future in concurrent.futures.as_completed(future_to_file):
                    orig_fname, path = future_to_file[future]
                    try:
                        txt = future.result()
                        if len(txt) > 10:
                            documents.append({"title": orig_fname, "text": txt, "path": path})
                    except Exception as exc:
                        print(f"Error processing {orig_fname}: {exc}")

        if not documents:
            return jsonify({'error': 'Please provide valid documents (text, pdf, docx, csv) with some text content.'}), 400
            
        n_clusters = int(request.form.get('n_clusters', 5))
        custom_names_raw = request.form.get('custom_names', '')
        custom_names = [n.strip() for n in custom_names_raw.split(',')] if custom_names_raw else []
        
        if len(documents) < 2:
            return jsonify({'error': 'Please provide at least 2 documents.'}), 400
        
        if n_clusters < 2 or n_clusters > len(documents):
            n_clusters = max(2, len(documents))

        # Run AI clustering pipeline
        result = cluster_documents(documents, n_clusters, custom_names)
        if 'error' in result:
            return jsonify(result), 400
            
        return jsonify(result)
    
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
