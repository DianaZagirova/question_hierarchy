"""
Optimized Knowledge Deduplication
- Batch embeddings for speed
- GPU acceleration if available
- Fast similarity computation
- Smart merging strategies
"""

import logging
import numpy as np
from typing import List, Dict, Tuple, Optional
from sklearn.metrics.pairwise import cosine_similarity

logger = logging.getLogger(__name__)


class OptimizedKnowledgeDeduplicator:
    """
    Deduplicate scientific pillars using semantic similarity
    Optimizations:
    - Batch embedding (10x faster)
    - GPU support (if available)
    - Efficient similarity matrix computation
    - Smart merging (preserve best quality)
    """

    def __init__(self, similarity_threshold: float = 0.85, use_gpu: bool = True):
        self.threshold = similarity_threshold
        self.model = None
        self.device = None

        self._initialize_model(use_gpu)

    def _initialize_model(self, use_gpu: bool):
        """Initialize embedding model with GPU support if available"""
        try:
            from sentence_transformers import SentenceTransformer
            import torch

            # Check GPU availability
            if use_gpu and torch.cuda.is_available():
                self.device = 'cuda'
                logger.info(f"[Deduplicator] Using GPU: {torch.cuda.get_device_name(0)}")
            else:
                self.device = 'cpu'
                logger.info("[Deduplicator] Using CPU")

            # Load lightweight model (22MB, 384 dims)
            self.model = SentenceTransformer('all-MiniLM-L6-v2', device=self.device)

            logger.info("[Deduplicator] Model loaded successfully")

        except ImportError as e:
            logger.error(f"sentence-transformers not installed: {e}")
            raise ImportError(
                "Please install: pip install sentence-transformers torch"
            )
        except Exception as e:
            logger.error(f"Failed to initialize model: {e}")
            # Fallback to CPU
            if use_gpu:
                logger.info("Falling back to CPU")
                self._initialize_model(use_gpu=False)
            else:
                raise

    def create_embeddings(self, pillars: List[Dict],
                          batch_size: int = 32) -> np.ndarray:
        """
        Create embeddings for all pillars (batched for speed)

        Args:
            pillars: List of scientific pillar dicts
            batch_size: Number to process at once (32 optimal for most GPUs)

        Returns:
            numpy array of embeddings (n_pillars, 384)
        """
        if not pillars:
            return np.array([])

        # Create text representation for each pillar
        texts = []
        for pillar in pillars:
            text = self._pillar_to_text(pillar)
            texts.append(text)

        # Batch encode (much faster than one-by-one)
        logger.info(f"[Dedup] Embedding {len(texts)} pillars (batch_size={batch_size})")
        embeddings = self.model.encode(
            texts,
            batch_size=batch_size,
            show_progress_bar=len(texts) > 50,
            convert_to_numpy=True,
            normalize_embeddings=True  # Normalize for cosine similarity
        )

        logger.info(f"[Dedup] Created embeddings: {embeddings.shape}")
        return embeddings

    def _pillar_to_text(self, pillar: Dict) -> str:
        """
        Convert pillar to text for embedding
        Prioritize: title > mechanism > verified_effect
        """
        parts = []

        # Title (most important)
        if pillar.get('title'):
            parts.append(pillar['title'])

        # Mechanism
        if pillar.get('mechanism'):
            # Remove citations for cleaner matching
            mech = pillar['mechanism']
            mech = mech.split('[')[0].strip()  # Remove [PMID: ...]
            parts.append(mech)

        # Verified effect
        if pillar.get('verified_effect'):
            effect = pillar['verified_effect']
            effect = effect.split('[')[0].strip()
            parts.append(effect)

        return ' '.join(parts)

    def find_duplicate_groups(self, embeddings: np.ndarray) -> List[List[int]]:
        """
        Find groups of duplicate pillars using similarity threshold

        Args:
            embeddings: Array of embeddings (n, 384)

        Returns:
            List of index groups, e.g. [[0, 5], [2, 7, 9]]
        """
        if len(embeddings) == 0:
            return []

        # Compute pairwise cosine similarities (optimized with normalized embeddings)
        logger.info(f"[Dedup] Computing {len(embeddings)}x{len(embeddings)} similarity matrix")

        # Embeddings are already normalized, so dot product = cosine similarity
        similarities = np.dot(embeddings, embeddings.T)

        # Find duplicate pairs (above threshold, excluding diagonal)
        duplicate_pairs = []
        for i in range(len(similarities)):
            for j in range(i + 1, len(similarities)):
                if similarities[i][j] >= self.threshold:
                    duplicate_pairs.append((i, j))

        logger.info(f"[Dedup] Found {len(duplicate_pairs)} duplicate pairs")

        # Group connected duplicates using union-find
        groups = self._group_duplicates(len(embeddings), duplicate_pairs)

        logger.info(f"[Dedup] Grouped into {len(groups)} duplicate clusters")
        return groups

    def _group_duplicates(self, n: int, pairs: List[Tuple[int, int]]) -> List[List[int]]:
        """
        Group duplicate pairs into connected components
        Uses union-find algorithm for efficiency
        """
        # Union-find data structure
        parent = list(range(n))

        def find(x):
            if parent[x] != x:
                parent[x] = find(parent[x])  # Path compression
            return parent[x]

        def union(x, y):
            px, py = find(x), find(y)
            if px != py:
                parent[px] = py

        # Union all duplicate pairs
        for i, j in pairs:
            union(i, j)

        # Group by root
        groups_dict: Dict[int, List[int]] = {}
        for i in range(n):
            root = find(i)
            if root not in groups_dict:
                groups_dict[root] = []
            groups_dict[root].append(i)

        # Filter to only groups with >1 member (actual duplicates)
        groups = [g for g in groups_dict.values() if len(g) > 1]

        return groups

    def merge_duplicates(self, pillars: List[Dict],
                         duplicate_groups: List[List[int]]) -> List[Dict]:
        """
        Merge duplicate pillars, keeping the best quality one as primary

        Args:
            pillars: List of all pillars
            duplicate_groups: Groups of duplicate indices

        Returns:
            List of deduplicated pillars
        """
        merged_pillars = []
        merged_indices = set()

        for group in duplicate_groups:
            # Find highest quality pillar in group
            group_pillars = [pillars[i] for i in group]
            best_pillar = self._select_best_pillar(group_pillars)

            # Merge source papers from all duplicates
            all_papers = []
            for idx in group:
                papers = pillars[idx].get('source_papers', [])
                all_papers.extend(papers)
                merged_indices.add(idx)

            # Deduplicate source papers by DOI/PMID
            unique_papers = self._deduplicate_papers(all_papers)

            # Update best pillar with all sources
            best_pillar['source_papers'] = unique_papers
            best_pillar['merged_from_count'] = len(group)
            best_pillar['duplicate_titles'] = [
                pillars[i].get('title', '') for i in group if i != group[0]
            ]

            merged_pillars.append(best_pillar)

            logger.debug(f"[Dedup] Merged {len(group)} pillars: {best_pillar['title'][:60]}")

        # Add non-duplicate pillars
        for i, pillar in enumerate(pillars):
            if i not in merged_indices:
                merged_pillars.append(pillar)

        logger.info(f"[Dedup] {len(pillars)} pillars → {len(merged_pillars)} after deduplication")
        logger.info(f"[Dedup] Removed {len(pillars) - len(merged_pillars)} duplicates")

        return merged_pillars

    def _select_best_pillar(self, pillars: List[Dict]) -> Dict:
        """
        Select best pillar from duplicates based on quality criteria
        """
        if len(pillars) == 1:
            return pillars[0]

        # Score each pillar
        scores = []
        for pillar in pillars:
            score = 0.0

            # More source papers = better
            paper_count = len(pillar.get('source_papers', []))
            score += paper_count * 0.3

            # Higher total citations = better
            total_citations = sum(
                p.get('citation_count', 0) for p in pillar.get('source_papers', [])
            )
            score += min(total_citations / 100, 0.3)

            # Higher readiness level = better
            rl = pillar.get('readiness_level', 'RL-1')
            rl_scores = {'RL-1': 0.1, 'RL-2': 0.2, 'RL-3': 0.3}
            score += rl_scores.get(rl, 0.1)

            # Longer mechanism/effect descriptions = better
            mech_len = len(pillar.get('mechanism', ''))
            effect_len = len(pillar.get('verified_effect', ''))
            score += min((mech_len + effect_len) / 1000, 0.1)

            scores.append(score)

        # Return pillar with highest score
        best_idx = np.argmax(scores)
        return pillars[best_idx].copy()

    def _deduplicate_papers(self, papers: List[Dict]) -> List[Dict]:
        """Deduplicate source papers by DOI/PMID"""
        seen_ids = set()
        unique = []

        for paper in papers:
            paper_id = paper.get('doi') or paper.get('pmid') or paper.get('title')
            if paper_id and paper_id not in seen_ids:
                seen_ids.add(paper_id)
                unique.append(paper)

        return unique

    def deduplicate(self, pillars: List[Dict],
                    return_embeddings: bool = False) -> Tuple[List[Dict], Optional[np.ndarray]]:
        """
        Complete deduplication pipeline

        Args:
            pillars: List of scientific pillars
            return_embeddings: If True, also return embeddings for caching

        Returns:
            (deduplicated_pillars, embeddings) if return_embeddings=True
            (deduplicated_pillars, None) otherwise
        """
        if not pillars:
            return pillars, None

        logger.info(f"[Dedup] Starting deduplication of {len(pillars)} pillars")

        # Step 1: Create embeddings (batched, GPU-accelerated)
        embeddings = self.create_embeddings(pillars)

        # Step 2: Find duplicate groups
        duplicate_groups = self.find_duplicate_groups(embeddings)

        # Step 3: Merge duplicates
        deduplicated = self.merge_duplicates(pillars, duplicate_groups)

        if return_embeddings:
            return deduplicated, embeddings
        else:
            return deduplicated, None


# Example usage
if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)

    # Sample pillars
    pillars = [
        {
            'id': 'S_1',
            'title': 'Mitochondrial biogenesis enhancement',
            'mechanism': 'PGC-1α activation increases mitochondrial DNA',
            'verified_effect': '20% increase in ATP production',
            'readiness_level': 'RL-2',
            'source_papers': [{'pmid': '123', 'citation_count': 50}]
        },
        {
            'id': 'S_2',
            'title': 'Enhanced mitochondrial biogenesis via PGC-1α',
            'mechanism': 'PGC-1α pathway activation',
            'verified_effect': 'Increased ATP output in cells',
            'readiness_level': 'RL-2',
            'source_papers': [{'pmid': '456', 'citation_count': 30}]
        },
        {
            'id': 'S_3',
            'title': 'Cellular senescence removal',
            'mechanism': 'Senolytic drugs target p16+ cells',
            'verified_effect': 'Reduced senescent cell burden',
            'readiness_level': 'RL-3',
            'source_papers': [{'pmid': '789', 'citation_count': 100}]
        }
    ]

    # Deduplicate
    deduplicator = OptimizedKnowledgeDeduplicator(similarity_threshold=0.85)
    deduplicated, _ = deduplicator.deduplicate(pillars)

    print(f"\nOriginal: {len(pillars)} pillars")
    print(f"After deduplication: {len(deduplicated)} pillars\n")

    for pillar in deduplicated:
        print(f"- {pillar['title']}")
        if 'merged_from_count' in pillar:
            print(f"  (merged from {pillar['merged_from_count']} duplicates)")
