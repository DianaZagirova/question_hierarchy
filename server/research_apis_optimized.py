"""
Optimized Research API Integration for Step 4
- Async I/O for parallel requests
- Smart rate limiting
- Response caching
- Quality filtering
- Timeout handling
"""

import asyncio
import aiohttp
import time
import logging
import hashlib
import json
from typing import List, Dict, Any, Optional
from xml.etree import ElementTree as ET
from datetime import datetime, timedelta
from collections import defaultdict

logger = logging.getLogger(__name__)


class APICache:
    """In-memory cache for API responses with TTL"""

    def __init__(self, ttl_hours: int = 24):
        self.cache: Dict[str, Dict] = {}
        self.ttl = timedelta(hours=ttl_hours)

    def _make_key(self, source: str, query: str) -> str:
        """Create cache key from source and query"""
        return hashlib.md5(f"{source}:{query}".encode()).hexdigest()

    def get(self, source: str, query: str) -> Optional[List[Dict]]:
        """Get cached results if not expired"""
        key = self._make_key(source, query)
        if key in self.cache:
            entry = self.cache[key]
            if datetime.now() - entry['timestamp'] < self.ttl:
                logger.debug(f"[Cache HIT] {source}:{query[:50]}")
                return entry['data']
            else:
                # Expired, remove
                del self.cache[key]
        return None

    def set(self, source: str, query: str, data: List[Dict]):
        """Cache results"""
        key = self._make_key(source, query)
        self.cache[key] = {
            'data': data,
            'timestamp': datetime.now()
        }

    def clear(self):
        """Clear all cache"""
        self.cache.clear()


class RateLimiter:
    """Token bucket rate limiter"""

    def __init__(self, requests_per_second: float):
        self.rate = requests_per_second
        self.tokens = requests_per_second
        self.last_update = time.time()
        self.lock = asyncio.Lock()

    async def acquire(self):
        """Wait until a token is available"""
        async with self.lock:
            now = time.time()
            elapsed = now - self.last_update
            self.tokens = min(self.rate, self.tokens + elapsed * self.rate)
            self.last_update = now

            if self.tokens < 1:
                sleep_time = (1 - self.tokens) / self.rate
                await asyncio.sleep(sleep_time)
                self.tokens = 0
            else:
                self.tokens -= 1


class OptimizedResearchAPIClient:
    """
    Optimized research API client with:
    - Async I/O for parallel requests
    - Response caching (24h TTL)
    - Smart rate limiting
    - Quality filtering
    - Timeout handling
    """

    def __init__(self, email: Optional[str] = None, cache_ttl: int = 24):
        self.pubmed_base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"
        self.semantic_base = "https://api.semanticscholar.org/graph/v1/"
        self.openalex_base = "https://api.openalex.org/"

        self.email = email
        self.cache = APICache(ttl_hours=cache_ttl)

        # Rate limiters (requests per second)
        self.rate_limiters = {
            'pubmed': RateLimiter(3.0),  # 3 req/sec without API key
            'semantic': RateLimiter(5.0),  # Conservative: 5 req/sec
            'openalex': RateLimiter(10.0)  # 10 req/sec
        }

        # Quality thresholds
        self.min_citation_count = 5  # Minimum citations (unless recent)
        self.min_abstract_length = 100  # Minimum abstract word count
        self.recency_years = 5  # Prefer papers from last 5 years

    async def _fetch_with_retry(self, session: aiohttp.ClientSession, url: str,
                                 params: Dict, max_retries: int = 2,
                                 timeout: int = 10, return_format: str = 'response') -> Optional[Any]:
        """
        Fetch URL with retries and timeout

        Args:
            return_format: 'response' (default), 'json', 'text', or 'bytes'
        """
        for attempt in range(max_retries + 1):
            try:
                async with session.get(url, params=params, timeout=timeout) as response:
                    if response.status == 200:
                        # Read content INSIDE context manager to avoid connection closed errors
                        if return_format == 'json':
                            return await response.json()
                        elif return_format == 'text':
                            return await response.text()
                        elif return_format == 'bytes':
                            return await response.read()
                        else:  # 'response' - deprecated, should use specific format
                            # Read as bytes for backwards compatibility
                            return await response.read()
                    elif response.status == 429:  # Rate limit
                        wait = 2 ** attempt
                        logger.warning(f"Rate limited, waiting {wait}s")
                        await asyncio.sleep(wait)
                    else:
                        logger.error(f"HTTP {response.status}: {url}")
                        return None
            except asyncio.TimeoutError:
                logger.warning(f"Timeout (attempt {attempt + 1}/{max_retries + 1})")
                if attempt < max_retries:
                    await asyncio.sleep(1)
            except Exception as e:
                logger.error(f"Request error: {e}")
                return None
        return None

    async def search_pubmed_async(self, query: str, max_results: int = 20) -> List[Dict]:
        """
        Async PubMed search with caching
        """
        # Check cache first
        cached = self.cache.get('pubmed', query)
        if cached is not None:
            return cached[:max_results]

        await self.rate_limiters['pubmed'].acquire()

        try:
            async with aiohttp.ClientSession() as session:
                # Step 1: Search for PMIDs
                search_url = f"{self.pubmed_base}esearch.fcgi"
                params = {
                    'db': 'pubmed',
                    'term': query,
                    'retmax': max_results,
                    'retmode': 'json',
                    'sort': 'relevance'
                }
                if self.email:
                    params['email'] = self.email

                logger.info(f"[PubMed] Searching: {query[:80]}")
                data = await self._fetch_with_retry(session, search_url, params, return_format='json')
                if not data:
                    return []

                pmids = data.get('esearchresult', {}).get('idlist', [])

                if not pmids:
                    logger.info(f"[PubMed] No results for: {query[:80]}")
                    return []

                logger.info(f"[PubMed] Found {len(pmids)} PMIDs")

                # Step 2: Fetch metadata
                await self.rate_limiters['pubmed'].acquire()

                fetch_url = f"{self.pubmed_base}efetch.fcgi"
                params = {
                    'db': 'pubmed',
                    'id': ','.join(pmids),
                    'retmode': 'xml',
                    'rettype': 'abstract'
                }
                if self.email:
                    params['email'] = self.email

                xml_content = await self._fetch_with_retry(session, fetch_url, params,
                                                        timeout=30, return_format='bytes')
                if not xml_content:
                    return []

                papers = self._parse_pubmed_xml(xml_content)

                # Filter by quality
                papers = self._filter_papers_by_quality(papers)

                # Cache results
                self.cache.set('pubmed', query, papers)

                logger.info(f"[PubMed] Returning {len(papers)} quality papers")
                return papers

        except Exception as e:
            logger.error(f"[PubMed] Error: {e}")
            return []

    def _parse_pubmed_xml(self, xml_content: bytes) -> List[Dict]:
        """Parse PubMed XML (same as before but optimized)"""
        papers = []
        try:
            root = ET.fromstring(xml_content)
            for article in root.findall('.//PubmedArticle'):
                try:
                    pmid_elem = article.find('.//PMID')
                    pmid = pmid_elem.text if pmid_elem is not None else None

                    title_elem = article.find('.//ArticleTitle')
                    title = title_elem.text if title_elem is not None else "No title"

                    abstract_texts = article.findall('.//AbstractText')
                    abstract = ' '.join([a.text for a in abstract_texts if a.text])

                    author_elems = article.findall('.//Author')
                    authors = []
                    for author in author_elems[:5]:
                        last_name = author.find('LastName')
                        fore_name = author.find('ForeName')
                        if last_name is not None:
                            name = last_name.text
                            if fore_name is not None:
                                name = f"{fore_name.text} {name}"
                            authors.append(name)

                    year_elem = article.find('.//PubDate/Year')
                    year = int(year_elem.text) if year_elem is not None else None

                    journal_elem = article.find('.//Journal/Title')
                    journal = journal_elem.text if journal_elem is not None else None

                    doi = None
                    for article_id in article.findall('.//ArticleId'):
                        if article_id.get('IdType') == 'doi':
                            doi = article_id.text
                            break

                    paper = {
                        'source': 'pubmed',
                        'pmid': pmid,
                        'doi': doi,
                        'title': title,
                        'abstract': abstract if abstract else None,
                        'authors': authors,
                        'year': year,
                        'journal': journal,
                        'citation_count': 0,  # PubMed doesn't provide this
                        'url': f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else None
                    }
                    papers.append(paper)

                except Exception as e:
                    logger.debug(f"Failed to parse article: {e}")
                    continue

        except Exception as e:
            logger.error(f"XML parsing error: {e}")

        return papers

    def _sanitize_query_for_semantic_scholar(self, query: str) -> str:
        """Remove PubMed-specific syntax for Semantic Scholar"""
        import re
        # Remove PubMed field tags like [MeSH Terms], [Title/Abstract], etc.
        clean = re.sub(r'\[[^\]]+\]', '', query)
        # Remove excess whitespace
        clean = ' '.join(clean.split())
        # Limit length (Semantic Scholar has query limits)
        if len(clean) > 200:
            clean = clean[:200]
        return clean

    async def search_semantic_scholar_async(self, query: str, max_results: int = 20) -> List[Dict]:
        """
        Async Semantic Scholar search with caching
        """
        # Sanitize query for Semantic Scholar (remove PubMed-specific syntax)
        clean_query = self._sanitize_query_for_semantic_scholar(query)

        # Check cache
        cached = self.cache.get('semantic', clean_query)
        if cached is not None:
            return cached[:max_results]

        await self.rate_limiters['semantic'].acquire()

        try:
            async with aiohttp.ClientSession() as session:
                url = f"{self.semantic_base}paper/search"
                params = {
                    'query': clean_query,
                    'limit': max_results,
                    'fields': 'title,abstract,authors,year,citationCount,influentialCitationCount,externalIds,openAccessPdf,journal'
                }

                logger.info(f"[Semantic Scholar] Searching: {clean_query[:80]}")
                data = await self._fetch_with_retry(session, url, params, return_format='json')
                if not data:
                    return []

                raw_papers = data.get('data', [])

                papers = []
                for p in raw_papers:
                    ext_ids = p.get('externalIds', {})
                    doi = ext_ids.get('DOI')
                    pmid = ext_ids.get('PubMed')
                    arxiv = ext_ids.get('ArXiv')

                    url = None
                    if doi:
                        url = f"https://doi.org/{doi}"
                    elif pmid:
                        url = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"
                    elif arxiv:
                        url = f"https://arxiv.org/abs/{arxiv}"

                    authors = [a.get('name', '') for a in p.get('authors', [])[:5]]

                    paper = {
                        'source': 'semantic_scholar',
                        'pmid': pmid,
                        'doi': doi,
                        'arxiv_id': arxiv,
                        'title': p.get('title', 'No title'),
                        'abstract': p.get('abstract'),
                        'authors': authors,
                        'year': p.get('year'),
                        'journal': p.get('journal', {}).get('name') if p.get('journal') else None,
                        'citation_count': p.get('citationCount', 0),
                        'influential_citation_count': p.get('influentialCitationCount', 0),
                        'url': url,
                        'pdf_url': p.get('openAccessPdf', {}).get('url') if p.get('openAccessPdf') else None
                    }
                    papers.append(paper)

                # Filter by quality
                papers = self._filter_papers_by_quality(papers)

                # Cache results
                self.cache.set('semantic', query, papers)

                logger.info(f"[Semantic Scholar] Returning {len(papers)} quality papers")
                return papers

        except Exception as e:
            logger.error(f"[Semantic Scholar] Error: {e}")
            return []

    async def search_openalex_async(self, query: str, max_results: int = 20) -> List[Dict]:
        """
        Async OpenAlex search with caching
        """
        # Check cache
        cached = self.cache.get('openalex', query)
        if cached is not None:
            return cached[:max_results]

        await self.rate_limiters['openalex'].acquire()

        try:
            async with aiohttp.ClientSession() as session:
                url = f"{self.openalex_base}works"
                params = {
                    'search': query,
                    'per-page': max_results,
                    'sort': 'cited_by_count:desc',
                    'select': 'id,doi,title,publication_year,abstract_inverted_index,authorships,cited_by_count,open_access,primary_location'
                }
                if self.email:
                    params['mailto'] = self.email

                logger.info(f"[OpenAlex] Searching: {query[:80]}")
                data = await self._fetch_with_retry(session, url, params, return_format='json')
                if not data:
                    return []

                results = data.get('results', [])

                papers = []
                for r in results:
                    abstract = self._reconstruct_abstract(r.get('abstract_inverted_index'))
                    authorships = r.get('authorships', [])
                    authors = [a.get('author', {}).get('display_name', '') for a in authorships[:5]]

                    doi = r.get('doi')
                    if doi and doi.startswith('https://doi.org/'):
                        doi = doi.replace('https://doi.org/', '')

                    journal = None
                    primary_location = r.get('primary_location', {})
                    if primary_location:
                        source = primary_location.get('source', {})
                        journal = source.get('display_name')

                    paper = {
                        'source': 'openalex',
                        'openalex_id': r.get('id'),
                        'doi': doi,
                        'title': r.get('title', 'No title'),
                        'abstract': abstract,
                        'authors': authors,
                        'year': r.get('publication_year'),
                        'journal': journal,
                        'citation_count': r.get('cited_by_count', 0),
                        'url': f"https://doi.org/{doi}" if doi else r.get('id'),
                        'is_open_access': r.get('open_access', {}).get('is_oa', False)
                    }
                    papers.append(paper)

                # Filter by quality
                papers = self._filter_papers_by_quality(papers)

                # Cache results
                self.cache.set('openalex', query, papers)

                logger.info(f"[OpenAlex] Returning {len(papers)} quality papers")
                return papers

        except Exception as e:
            logger.error(f"[OpenAlex] Error: {e}")
            return []

    def _reconstruct_abstract(self, inverted_index: Optional[Dict]) -> Optional[str]:
        """Reconstruct abstract from OpenAlex inverted index"""
        if not inverted_index:
            return None
        try:
            words = {}
            for word, positions in inverted_index.items():
                for pos in positions:
                    words[pos] = word
            sorted_positions = sorted(words.keys())
            abstract = ' '.join(words[pos] for pos in sorted_positions)
            return abstract
        except Exception:
            return None

    def _filter_papers_by_quality(self, papers: List[Dict]) -> List[Dict]:
        """
        Filter papers by quality criteria:
        - Minimum citation count (unless very recent)
        - Minimum abstract length
        - Prefer recent papers
        """
        current_year = datetime.now().year
        filtered = []

        for paper in papers:
            # Check abstract length
            abstract = paper.get('abstract', '')
            if abstract:
                word_count = len(abstract.split())
                if word_count < self.min_abstract_length:
                    logger.debug(f"Skipped (short abstract): {paper['title'][:50]}")
                    continue

            # Check citations (unless very recent)
            year = paper.get('year')
            citation_count = paper.get('citation_count', 0)

            if year and current_year - year <= 2:
                # Very recent paper, skip citation check
                pass
            elif citation_count < self.min_citation_count:
                logger.debug(f"Skipped (low citations): {paper['title'][:50]}")
                continue

            # Calculate quality score
            paper['quality_score'] = self._calculate_paper_quality(paper)

            filtered.append(paper)

        # Sort by quality score
        filtered.sort(key=lambda p: p['quality_score'], reverse=True)

        return filtered

    def _calculate_paper_quality(self, paper: Dict) -> float:
        """
        Calculate paper quality score (0-1)
        Based on: citations, recency, journal, open access
        """
        score = 0.0
        current_year = datetime.now().year

        # Citation score (0-0.4)
        citation_count = paper.get('citation_count', 0)
        citation_score = min(citation_count / 100, 0.4)
        score += citation_score

        # Recency score (0-0.3)
        year = paper.get('year')
        if year:
            age = current_year - year
            if age <= self.recency_years:
                recency_score = 0.3 * (1 - age / self.recency_years)
                score += recency_score

        # Journal score (0-0.2)
        journal = paper.get('journal', '')
        if journal:
            # Boost for high-impact journals
            high_impact = ['nature', 'science', 'cell', 'lancet', 'nejm', 'pnas']
            if any(j in journal.lower() for j in high_impact):
                score += 0.2
            else:
                score += 0.1

        # Open access bonus (0-0.1)
        if paper.get('is_open_access') or paper.get('pdf_url'):
            score += 0.1

        return min(score, 1.0)

    async def fetch_unified_async(self, query: str,
                                   sources: List[str] = ['pubmed', 'semantic_scholar'],
                                   max_per_source: int = 15) -> List[Dict]:
        """
        Fetch papers from multiple sources in parallel
        Returns deduplicated, quality-filtered results
        """
        tasks = []

        for source in sources:
            if source == 'pubmed':
                tasks.append(self.search_pubmed_async(query, max_per_source))
            elif source == 'semantic_scholar':
                tasks.append(self.search_semantic_scholar_async(query, max_per_source))
            elif source == 'openalex':
                tasks.append(self.search_openalex_async(query, max_per_source))

        # Execute all searches in parallel
        results = await asyncio.gather(*tasks, return_exceptions=True)

        all_papers = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"Source {sources[i]} failed: {result}")
            elif isinstance(result, list):
                all_papers.extend(result)

        # Deduplicate
        unique_papers = self._deduplicate_papers(all_papers)

        # Sort by quality score
        unique_papers.sort(key=lambda p: p.get('quality_score', 0), reverse=True)

        logger.info(f"[Unified] {len(all_papers)} total → {len(unique_papers)} unique papers")

        return unique_papers

    def _deduplicate_papers(self, papers: List[Dict]) -> List[Dict]:
        """Deduplicate papers by DOI, PMID, or title"""
        seen_ids = set()
        unique_papers = []

        for paper in papers:
            paper_id = None
            if paper.get('doi'):
                paper_id = f"doi:{paper['doi'].lower()}"
            elif paper.get('pmid'):
                paper_id = f"pmid:{paper['pmid']}"
            elif paper.get('arxiv_id'):
                paper_id = f"arxiv:{paper['arxiv_id']}"
            else:
                title = paper.get('title', '').lower().strip()
                paper_id = f"title:{title}"

            if paper_id not in seen_ids:
                seen_ids.add(paper_id)
                unique_papers.append(paper)

        return unique_papers

    def fetch_unified(self, query: str,
                      sources: List[str] = ['pubmed', 'semantic_scholar'],
                      max_per_source: int = 15) -> List[Dict]:
        """
        Synchronous wrapper for async fetch_unified
        For backward compatibility
        """
        return asyncio.run(self.fetch_unified_async(query, sources, max_per_source))


# Convenience function for quick testing
if __name__ == '__main__':
    import sys
    logging.basicConfig(level=logging.INFO)

    client = OptimizedResearchAPIClient(email="test@example.com")

    query = sys.argv[1] if len(sys.argv) > 1 else "mitochondrial function aging"

    print(f"\nSearching for: {query}\n")

    papers = client.fetch_unified(
        query=query,
        sources=['pubmed', 'semantic_scholar', 'openalex'],
        max_per_source=10
    )

    print(f"\nFound {len(papers)} high-quality papers:\n")

    for i, paper in enumerate(papers[:5], 1):
        print(f"{i}. {paper['title']}")
        print(f"   Quality: {paper.get('quality_score', 0):.2f}")
        print(f"   Year: {paper.get('year', 'N/A')} | Citations: {paper.get('citation_count', 0)}")
        print(f"   Source: {paper['source']}")
        print()
