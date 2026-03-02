"""
Research API Integration for Step 4
Fetches real scientific papers from multiple sources
"""

import requests
import time
import logging
from typing import List, Dict, Any, Optional
from xml.etree import ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed

logger = logging.getLogger(__name__)


class ResearchAPIClient:
    """Unified client for multiple research databases"""

    def __init__(self, email: Optional[str] = None):
        self.pubmed_base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"
        self.semantic_base = "https://api.semanticscholar.org/graph/v1/"
        self.openalex_base = "https://api.openalex.org/"
        self.arxiv_base = "http://export.arxiv.org/api/query"

        # Email for polite API usage (recommended by PubMed)
        self.email = email

        # Rate limiting
        self.last_request_time = {}
        self.min_request_interval = {
            'pubmed': 0.34,  # Max 3 requests/second without API key
            'semantic': 0.1,  # 10 req/sec for free tier
            'openalex': 0.1,  # Generous limits
        }

    def _rate_limit(self, api_name: str):
        """Ensure we don't exceed API rate limits"""
        if api_name in self.last_request_time:
            elapsed = time.time() - self.last_request_time[api_name]
            min_interval = self.min_request_interval.get(api_name, 0.1)
            if elapsed < min_interval:
                time.sleep(min_interval - elapsed)

        self.last_request_time[api_name] = time.time()

    def search_pubmed(self, query: str, max_results: int = 20) -> List[Dict]:
        """
        Search PubMed and fetch paper metadata

        Returns list of papers with:
        - pmid, doi, title, abstract, authors, year, journal
        """
        try:
            self._rate_limit('pubmed')

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

            logger.info(f"[PubMed] Searching: {query[:100]}")
            response = requests.get(search_url, params=params, timeout=30)
            response.raise_for_status()

            search_data = response.json()
            pmids = search_data.get('esearchresult', {}).get('idlist', [])

            if not pmids:
                logger.warning(f"[PubMed] No results for: {query}")
                return []

            logger.info(f"[PubMed] Found {len(pmids)} PMIDs")

            # Step 2: Fetch full metadata
            self._rate_limit('pubmed')

            fetch_url = f"{self.pubmed_base}efetch.fcgi"
            params = {
                'db': 'pubmed',
                'id': ','.join(pmids),
                'retmode': 'xml',
                'rettype': 'abstract'
            }

            if self.email:
                params['email'] = self.email

            response = requests.get(fetch_url, params=params, timeout=60)
            response.raise_for_status()

            # Parse XML and extract metadata
            papers = self._parse_pubmed_xml(response.content)

            logger.info(f"[PubMed] Successfully parsed {len(papers)} papers")
            return papers

        except Exception as e:
            logger.error(f"[PubMed] Error: {e}")
            return []

    def _parse_pubmed_xml(self, xml_content: bytes) -> List[Dict]:
        """Parse PubMed XML response into structured paper data"""
        papers = []

        try:
            root = ET.fromstring(xml_content)

            for article in root.findall('.//PubmedArticle'):
                try:
                    # PMID
                    pmid_elem = article.find('.//PMID')
                    pmid = pmid_elem.text if pmid_elem is not None else None

                    # Title
                    title_elem = article.find('.//ArticleTitle')
                    title = title_elem.text if title_elem is not None else "No title"

                    # Abstract
                    abstract_texts = article.findall('.//AbstractText')
                    abstract = ' '.join([a.text for a in abstract_texts if a.text])

                    # Authors
                    author_elems = article.findall('.//Author')
                    authors = []
                    for author in author_elems[:5]:  # First 5 authors
                        last_name = author.find('LastName')
                        fore_name = author.find('ForeName')
                        if last_name is not None:
                            name = last_name.text
                            if fore_name is not None:
                                name = f"{fore_name.text} {name}"
                            authors.append(name)

                    # Year
                    year_elem = article.find('.//PubDate/Year')
                    year = int(year_elem.text) if year_elem is not None else None

                    # Journal
                    journal_elem = article.find('.//Journal/Title')
                    journal = journal_elem.text if journal_elem is not None else None

                    # DOI
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
                        'url': f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else None
                    }

                    papers.append(paper)

                except Exception as e:
                    logger.warning(f"[PubMed] Failed to parse article: {e}")
                    continue

        except Exception as e:
            logger.error(f"[PubMed] XML parsing error: {e}")

        return papers

    def search_semantic_scholar(self, query: str, max_results: int = 20) -> List[Dict]:
        """
        Search Semantic Scholar API

        Returns list of papers with citation counts and influence scores
        """
        try:
            self._rate_limit('semantic')

            url = f"{self.semantic_base}paper/search"
            params = {
                'query': query,
                'limit': max_results,
                'fields': 'title,abstract,authors,year,citationCount,influentialCitationCount,externalIds,openAccessPdf,journal'
            }

            logger.info(f"[Semantic Scholar] Searching: {query[:100]}")
            response = requests.get(url, params=params, timeout=30)
            response.raise_for_status()

            data = response.json()
            raw_papers = data.get('data', [])

            papers = []
            for p in raw_papers:
                # Extract external IDs
                ext_ids = p.get('externalIds', {})
                doi = ext_ids.get('DOI')
                pmid = ext_ids.get('PubMed')
                arxiv = ext_ids.get('ArXiv')

                # Build URL (prefer DOI, then PMID, then arXiv)
                url = None
                if doi:
                    url = f"https://doi.org/{doi}"
                elif pmid:
                    url = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"
                elif arxiv:
                    url = f"https://arxiv.org/abs/{arxiv}"

                # Authors
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

            logger.info(f"[Semantic Scholar] Found {len(papers)} papers")
            return papers

        except Exception as e:
            logger.error(f"[Semantic Scholar] Error: {e}")
            return []

    def search_openalex(self, query: str, max_results: int = 20) -> List[Dict]:
        """
        Search OpenAlex API

        Returns list of papers with comprehensive metadata
        """
        try:
            self._rate_limit('openalex')

            url = f"{self.openalex_base}works"
            params = {
                'search': query,
                'per-page': max_results,
                'sort': 'cited_by_count:desc',
                'select': 'id,doi,title,publication_year,abstract_inverted_index,authorships,cited_by_count,open_access,primary_location'
            }

            if self.email:
                params['mailto'] = self.email

            logger.info(f"[OpenAlex] Searching: {query[:100]}")
            response = requests.get(url, params=params, timeout=30)
            response.raise_for_status()

            data = response.json()
            results = data.get('results', [])

            papers = []
            for r in results:
                # Reconstruct abstract from inverted index
                abstract = self._reconstruct_abstract(r.get('abstract_inverted_index'))

                # Authors
                authorships = r.get('authorships', [])
                authors = [a.get('author', {}).get('display_name', '') for a in authorships[:5]]

                # DOI
                doi = r.get('doi')
                if doi and doi.startswith('https://doi.org/'):
                    doi = doi.replace('https://doi.org/', '')

                # Journal
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

            logger.info(f"[OpenAlex] Found {len(papers)} papers")
            return papers

        except Exception as e:
            logger.error(f"[OpenAlex] Error: {e}")
            return []

    def _reconstruct_abstract(self, inverted_index: Optional[Dict]) -> Optional[str]:
        """Reconstruct abstract text from OpenAlex inverted index"""
        if not inverted_index:
            return None

        try:
            # Inverted index: {"word": [positions], ...}
            # Reconstruct: position -> word
            words = {}
            for word, positions in inverted_index.items():
                for pos in positions:
                    words[pos] = word

            # Sort by position and join
            sorted_positions = sorted(words.keys())
            abstract = ' '.join(words[pos] for pos in sorted_positions)

            return abstract

        except Exception:
            return None

    def fetch_unified(self, query: str,
                      sources: List[str] = ['pubmed', 'semantic_scholar'],
                      max_per_source: int = 10,
                      parallel: bool = True) -> List[Dict]:
        """
        Fetch papers from multiple sources and merge results

        Args:
            query: Search query
            sources: List of sources to query ['pubmed', 'semantic_scholar', 'openalex']
            max_per_source: Max papers per source
            parallel: Execute searches in parallel

        Returns:
            Deduplicated list of papers from all sources
        """
        all_papers = []

        def fetch_from_source(source: str) -> List[Dict]:
            """Helper to fetch from a single source"""
            try:
                if source == 'pubmed':
                    return self.search_pubmed(query, max_per_source)
                elif source == 'semantic_scholar':
                    return self.search_semantic_scholar(query, max_per_source)
                elif source == 'openalex':
                    return self.search_openalex(query, max_per_source)
                else:
                    logger.warning(f"Unknown source: {source}")
                    return []
            except Exception as e:
                logger.error(f"Error fetching from {source}: {e}")
                return []

        if parallel and len(sources) > 1:
            # Parallel execution
            with ThreadPoolExecutor(max_workers=len(sources)) as executor:
                future_to_source = {
                    executor.submit(fetch_from_source, source): source
                    for source in sources
                }

                for future in as_completed(future_to_source):
                    source = future_to_source[future]
                    try:
                        papers = future.result()
                        all_papers.extend(papers)
                        logger.info(f"Fetched {len(papers)} papers from {source}")
                    except Exception as e:
                        logger.error(f"Error processing {source}: {e}")
        else:
            # Sequential execution
            for source in sources:
                papers = fetch_from_source(source)
                all_papers.extend(papers)

        # Deduplicate by DOI, PMID, or title
        unique_papers = self._deduplicate_papers(all_papers)

        logger.info(f"Total papers: {len(all_papers)} → After dedup: {len(unique_papers)}")

        return unique_papers

    def _deduplicate_papers(self, papers: List[Dict]) -> List[Dict]:
        """Deduplicate papers by DOI, PMID, or title"""
        seen_ids = set()
        unique_papers = []

        for paper in papers:
            # Create unique ID (prefer DOI > PMID > title)
            paper_id = None

            if paper.get('doi'):
                paper_id = f"doi:{paper['doi'].lower()}"
            elif paper.get('pmid'):
                paper_id = f"pmid:{paper['pmid']}"
            elif paper.get('arxiv_id'):
                paper_id = f"arxiv:{paper['arxiv_id']}"
            else:
                # Fallback to title (normalized)
                title = paper.get('title', '').lower().strip()
                paper_id = f"title:{title}"

            if paper_id not in seen_ids:
                seen_ids.add(paper_id)
                unique_papers.append(paper)

        return unique_papers


# Example usage
if __name__ == '__main__':
    # Configure logging
    logging.basicConfig(level=logging.INFO)

    # Create client
    client = ResearchAPIClient(email="your-email@example.com")

    # Test query
    query = "(mitochondrial function) AND (aging OR longevity)"

    print(f"\nSearching for: {query}\n")

    # Fetch from multiple sources
    papers = client.fetch_unified(
        query=query,
        sources=['pubmed', 'semantic_scholar'],
        max_per_source=5,
        parallel=True
    )

    print(f"\nFound {len(papers)} unique papers:\n")

    for i, paper in enumerate(papers, 1):
        print(f"{i}. {paper['title']}")
        print(f"   Source: {paper['source']}")
        print(f"   Year: {paper.get('year', 'N/A')}")
        print(f"   DOI: {paper.get('doi', 'N/A')}")
        print(f"   PMID: {paper.get('pmid', 'N/A')}")
        print(f"   Citations: {paper.get('citation_count', 0)}")
        print(f"   URL: {paper.get('url', 'N/A')}")
        print()
