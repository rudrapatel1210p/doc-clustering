import re
import nltk
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA

# Download NLTK data (only runs once)
nltk.download('stopwords', quiet=True)
from nltk.corpus import stopwords

STOP_WORDS = set(stopwords.words('english'))

def preprocess(text):
    text = text.lower()
    text = re.sub(r'[^a-z\s]', '', text)
    words = text.split()
    words = [w for w in words if w not in STOP_WORDS]
    words = [w for w in words if len(w) > 2]
    return ' '.join(words)

def cluster_documents(doc_objects, n_clusters=5, custom_names=None):
    """
    doc_objects: list of dicts, e.g. [{"title": "Doc1", "text": "Content..."}, ...]
    returns rich structured data for the frontend mapping.
    """
    cleaned_docs = [preprocess(d.get('text', '')) for d in doc_objects]
    
    valid_indices = [i for i, d in enumerate(cleaned_docs) if len(d.strip()) > 0]
    cleaned_docs = [cleaned_docs[i] for i in valid_indices]
    original_docs = [doc_objects[i] for i in valid_indices]
    
    if len(cleaned_docs) < 2:
        return {'error': 'Not enough valid text content extracted to cluster.'}
        
    if len(cleaned_docs) < n_clusters:
        n_clusters = max(2, len(cleaned_docs))
    
    vectorizer = TfidfVectorizer(max_features=300, ngram_range=(1, 2), min_df=1)
    tfidf_matrix = vectorizer.fit_transform(cleaned_docs)
    
    kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
    labels = kmeans.fit_predict(tfidf_matrix)
    
    # Calculate simple confidence mapped to distance
    distances = kmeans.transform(tfidf_matrix)
    confidences = []
    for i in range(len(labels)):
        dist = distances[i, labels[i]]
        # A simple mapping to generate a 'Quality Score' percentage (cap between 10 and 99)
        conf = max(10, min(99, int((1 - dist) * 100)))
        confidences.append(conf)
    
    feature_names = vectorizer.get_feature_names_out()
    cluster_info = {}
    
    for cluster_id in range(n_clusters):
        cluster_doc_indices = np.where(labels == cluster_id)[0]
        
        if len(cluster_doc_indices) == 0:
            cluster_info[cluster_id] = {'name': f"Folder {cluster_id+1}", 'keywords': [], 'docs': [], 'count': 0, 'avg_conf': 0}
            continue
        
        cluster_tfidf_avg = tfidf_matrix[cluster_doc_indices].toarray().mean(axis=0)
        # Get top 5 keywords
        top_word_indices = cluster_tfidf_avg.argsort()[-5:][::-1]
        keywords = [feature_names[i] for i in top_word_indices]
        
        # Name resolution: custom or fallback
        if custom_names and cluster_id < len(custom_names) and custom_names[cluster_id].strip():
            folder_name = custom_names[cluster_id].strip()
        else:
            folder_name = " & ".join(keywords[:2]).title() if keywords else f"Folder {cluster_id+1}"
            
        cluster_docs = []
        cluster_confs = []
        for idx in cluster_doc_indices:
            doc = original_docs[idx].copy()
            doc['confidence'] = confidences[idx]
            doc['cluster_id'] = cluster_id
            doc['path'] = original_docs[idx].get('path', doc['title']) # Default to title if no path
            cluster_docs.append(doc)
            cluster_confs.append(confidences[idx])
            
        cluster_info[cluster_id] = {
            'id': cluster_id,
            'name': folder_name,
            'keywords': keywords,
            'docs': cluster_docs,
            'count': len(cluster_docs),
            'avg_conf': int(np.mean(cluster_confs)) if cluster_confs else 0
        }
    
    # 2D PCA representation
    pca = PCA(n_components=2, random_state=42)
    coords_2d = pca.fit_transform(tfidf_matrix.toarray())
    
    coords_list = []
    for i, idx in enumerate(valid_indices):
        coords_list.append({
            'x': float(coords_2d[i][0]) if not np.isnan(coords_2d[i][0]) else 0.0,
            'y': float(coords_2d[i][1]) if not np.isnan(coords_2d[i][1]) else 0.0,
            'cluster': int(labels[i]),
            'title': original_docs[i]['title'],
            'path': original_docs[i].get('path', original_docs[i]['title'])
        })
        
    return {
        'n_clusters': n_clusters,
        'cluster_info': {str(k): v for k, v in cluster_info.items()},
        'coords': coords_list
    }
