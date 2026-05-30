from finsight.config import Settings
from finsight.data.sec import get_primary_document_from_index


def test_primary_document_uses_archive_directory_index_json(monkeypatch):
    import finsight.data.sec as sec

    captured = {}

    def fake_get_json(url, headers, settings):
        captured["url"] = url
        return {
            "directory": {
                "item": [
                    {"name": "aapl-20250927.htm"},
                    {"name": "exhibit-10.htm"},
                ]
            }
        }

    monkeypatch.setattr(sec, "_get_json", fake_get_json)

    primary = get_primary_document_from_index(
        cik="0000320193",
        accession="0000320193-25-000079",
        preferred=None,
        headers={},
        settings=Settings(),
    )

    assert primary == "aapl-20250927.htm"
    assert (
        captured["url"]
        == "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/index.json"
    )
