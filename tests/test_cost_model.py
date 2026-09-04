from ferrocat.domain import estimate_cost


def test_tunnel_costs_more_than_surface() -> None:
    surface = estimate_cost(new_surface_km=5).total_m_eur
    tunnel = estimate_cost(tunnel_km=5).total_m_eur
    assert tunnel > surface


def test_existing_costs_less_than_new_surface() -> None:
    existing = estimate_cost(existing_active_km=10).total_m_eur
    new = estimate_cost(new_surface_km=10).total_m_eur
    assert existing < new
