from ferrocat.rail import build_multicolor_stripes


def test_multicolor_has_one_stripe_per_service() -> None:
    stripes = build_multicolor_stripes([(0,0),(100,0)], [("R1","#f00"),("R2","#0f0"),("RL3","#00f"),("RG1","#ff0")])
    assert len(stripes) == 4
    assert len({s.offset_px for s in stripes}) == 4
    assert {s.color for s in stripes} == {"#f00","#0f0","#00f","#ff0"}


def test_multicolor_order_is_deterministic() -> None:
    a = build_multicolor_stripes([(0,0),(10,10)], [("Z","red"),("A","blue")])
    b = build_multicolor_stripes([(0,0),(10,10)], [("A","blue"),("Z","red")])
    assert [(x.service_id,x.offset_px) for x in a] == [(x.service_id,x.offset_px) for x in b]
