#!/usr/bin/env python3
"""
Quick test script for Research API Integration
Run this to verify the research APIs are working
"""

import sys
import os

# Add server directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'server'))

from research_apis import ResearchAPIClient
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)

def test_pubmed():
    """Test PubMed API"""
    print("\n" + "="*70)
    print("TESTING PUBMED API")
    print("="*70)

    client = ResearchAPIClient(email="test@example.com")

    query = "(mitochondrial function) AND (aging)"
    print(f"\nQuery: {query}")

    papers = client.search_pubmed(query, max_results=5)

    print(f"\nFound {len(papers)} papers:")
    for i, paper in enumerate(papers, 1):
        print(f"\n{i}. {paper['title']}")
        print(f"   PMID: {paper.get('pmid', 'N/A')}")
        print(f"   DOI: {paper.get('doi', 'N/A')}")
        print(f"   Year: {paper.get('year', 'N/A')}")
        print(f"   Journal: {paper.get('journal', 'N/A')}")
        print(f"   Authors: {', '.join(paper.get('authors', [])[:3])}")
        print(f"   Abstract: {paper.get('abstract', 'N/A')[:200]}...")

def test_semantic_scholar():
    """Test Semantic Scholar API"""
    print("\n" + "="*70)
    print("TESTING SEMANTIC SCHOLAR API")
    print("="*70)

    client = ResearchAPIClient()

    query = "cellular senescence aging interventions"
    print(f"\nQuery: {query}")

    papers = client.search_semantic_scholar(query, max_results=5)

    print(f"\nFound {len(papers)} papers:")
    for i, paper in enumerate(papers, 1):
        print(f"\n{i}. {paper['title']}")
        print(f"   DOI: {paper.get('doi', 'N/A')}")
        print(f"   Year: {paper.get('year', 'N/A')}")
        print(f"   Citations: {paper.get('citation_count', 0)}")
        print(f"   Influential Citations: {paper.get('influential_citation_count', 0)}")
        print(f"   URL: {paper.get('url', 'N/A')}")

def test_openalex():
    """Test OpenAlex API"""
    print("\n" + "="*70)
    print("TESTING OPENALEX API")
    print("="*70)

    client = ResearchAPIClient(email="test@example.com")

    query = "autophagy longevity extension"
    print(f"\nQuery: {query}")

    papers = client.search_openalex(query, max_results=5)

    print(f"\nFound {len(papers)} papers:")
    for i, paper in enumerate(papers, 1):
        print(f"\n{i}. {paper['title']}")
        print(f"   DOI: {paper.get('doi', 'N/A')}")
        print(f"   Year: {paper.get('year', 'N/A')}")
        print(f"   Citations: {paper.get('citation_count', 0)}")
        print(f"   Open Access: {paper.get('is_open_access', False)}")
        print(f"   URL: {paper.get('url', 'N/A')}")

def test_unified():
    """Test unified search across all sources"""
    print("\n" + "="*70)
    print("TESTING UNIFIED SEARCH (ALL SOURCES)")
    print("="*70)

    client = ResearchAPIClient(email="test@example.com")

    query = "NAD+ supplementation aging"
    print(f"\nQuery: {query}")

    papers = client.fetch_unified(
        query=query,
        sources=['pubmed', 'semantic_scholar', 'openalex'],
        max_per_source=3,
        parallel=True
    )

    print(f"\nFound {len(papers)} unique papers from all sources:")
    for i, paper in enumerate(papers, 1):
        print(f"\n{i}. {paper['title']}")
        print(f"   Source: {paper['source']}")
        print(f"   Year: {paper.get('year', 'N/A')}")
        print(f"   DOI: {paper.get('doi', 'N/A')}")
        print(f"   PMID: {paper.get('pmid', 'N/A')}")
        print(f"   Citations: {paper.get('citation_count', 0)}")
        print(f"   URL: {paper.get('url', 'N/A')}")

def main():
    """Run all tests"""
    print("\n" + "="*70)
    print("RESEARCH API INTEGRATION TEST SUITE")
    print("="*70)

    try:
        # Test each API individually
        test_pubmed()
        print("\n✓ PubMed API: SUCCESS")
    except Exception as e:
        print(f"\n✗ PubMed API: FAILED - {e}")

    try:
        test_semantic_scholar()
        print("\n✓ Semantic Scholar API: SUCCESS")
    except Exception as e:
        print(f"\n✗ Semantic Scholar API: FAILED - {e}")

    try:
        test_openalex()
        print("\n✓ OpenAlex API: SUCCESS")
    except Exception as e:
        print(f"\n✗ OpenAlex API: FAILED - {e}")

    try:
        test_unified()
        print("\n✓ Unified Search: SUCCESS")
    except Exception as e:
        print(f"\n✗ Unified Search: FAILED - {e}")

    print("\n" + "="*70)
    print("TEST SUITE COMPLETE")
    print("="*70 + "\n")

if __name__ == '__main__':
    main()
