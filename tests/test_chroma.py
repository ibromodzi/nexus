from finsight.engine import persistence


def test_chroma_store_report_calls_collection_add(monkeypatch):
    calls = {}

    class FakeCollection:
        def add(self, documents=None, metadatas=None, ids=None):
            calls['documents'] = documents
            calls['metadatas'] = metadatas
            calls['ids'] = ids

    fake = FakeCollection()

    monkeypatch.setattr(persistence, 'get_chroma_collection', lambda path=None, collection_name='finsight_reports': fake)

    rr = {
        'risk_level': 'moderate',
        'composite_score': 42.5,
        'recommendation': 'review',
        'data_quality': 'partial',
        'dominant_theme': 'catalyst_positive',
        'summary': 'Test summary for XYZ',
    }

    ok = persistence.chroma_store_report('XYZ', rr)
    assert ok is True
    assert 'documents' in calls
    assert isinstance(calls['documents'], list)
    assert calls['metadatas'][0]['ticker'] == 'XYZ'


def test_chroma_search_returns_hits(monkeypatch):
    class FakeCollection:
        def query(self, query_texts=None, n_results=5):
            return {
                'documents': [['doc1', 'doc2']],
                'metadatas': [[{'ticker': 'ABC'}, {'ticker': 'XYZ'}]],
                'distances': [[0.12, 0.33]],
            }

    fake = FakeCollection()
    monkeypatch.setattr(persistence, 'get_chroma_collection', lambda path=None, collection_name='finsight_reports': fake)

    hits = persistence.chroma_search('find risk', n_results=2)
    assert isinstance(hits, list)
    assert len(hits) == 2
    assert hits[0]['metadata']['ticker'] == 'ABC'
