from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CostParameters:
    existing_active_m_eur_km: float = 2.0
    existing_disused_m_eur_km: float = 4.0
    new_surface_m_eur_km: float = 12.0
    tunnel_m_eur_km: float = 80.0
    viaduct_m_eur_km: float = 35.0
    cut_fill_m_eur_km: float = 18.0


@dataclass(frozen=True)
class CostBreakdown:
    existing_active_m_eur: float = 0.0
    existing_disused_m_eur: float = 0.0
    new_surface_m_eur: float = 0.0
    tunnel_m_eur: float = 0.0
    viaduct_m_eur: float = 0.0
    cut_fill_m_eur: float = 0.0

    @property
    def total_m_eur(self) -> float:
        return (
            self.existing_active_m_eur
            + self.existing_disused_m_eur
            + self.new_surface_m_eur
            + self.tunnel_m_eur
            + self.viaduct_m_eur
            + self.cut_fill_m_eur
        )


def estimate_cost(
    *,
    existing_active_km: float = 0.0,
    existing_disused_km: float = 0.0,
    new_surface_km: float = 0.0,
    tunnel_km: float = 0.0,
    viaduct_km: float = 0.0,
    cut_fill_km: float = 0.0,
    params: CostParameters = CostParameters(),
) -> CostBreakdown:
    values = [
        existing_active_km,
        existing_disused_km,
        new_surface_km,
        tunnel_km,
        viaduct_km,
        cut_fill_km,
    ]
    if any(v < 0 for v in values):
        raise ValueError("Les longituds de cost no poden ser negatives")
    return CostBreakdown(
        existing_active_m_eur=existing_active_km * params.existing_active_m_eur_km,
        existing_disused_m_eur=existing_disused_km * params.existing_disused_m_eur_km,
        new_surface_m_eur=new_surface_km * params.new_surface_m_eur_km,
        tunnel_m_eur=tunnel_km * params.tunnel_m_eur_km,
        viaduct_m_eur=viaduct_km * params.viaduct_m_eur_km,
        cut_fill_m_eur=cut_fill_km * params.cut_fill_m_eur_km,
    )
