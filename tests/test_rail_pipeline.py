from pipelines.download_rail_infrastructure import build_runtime


def test_rtt_rail_types_are_split_from_roads() -> None:
    features=[
        {'type':'Feature','properties':{'tipus':'fvc','nom':'rail'},'geometry':{'type':'LineString','coordinates':[[1,41],[2,42]]}},
        {'type':'Feature','properties':{'tipus':'aut','nom':'road'},'geometry':{'type':'LineString','coordinates':[[1,41],[1.1,41.1]]}},
    ]
    rail,roads=build_runtime(features)
    assert len(rail)==1
    assert len(roads)==1
    assert rail[0]['nom']=='rail'
