//! Pure chassis planner: `ChassisConfig` → the axles and position codes to
//! create. Extracted OUT of `chassis_create`'s DB work so the code-generation
//! rules — the thing that must never drift from maint-rust's chassis_builder,
//! and never produce a duplicate or malformed code — are testable and
//! fuzzable in isolation.
//!
//! Codes: tractor steering H1L/H1R; tractor drive axles H{n}{LO,LI,RI,RO};
//! trailer axles TR{n}{L,R} (single) or TR{n}{LO,LI,RI,RO} (dual); spares
//! SP{n}. Position `axle` indexes into `axles` (None for spares).

/// A tractor/trailer axle in the plan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedAxle {
    pub section: &'static str,
    pub index: i64,
    pub axle_type: &'static str,
    pub is_steering: bool,
}

/// A wheel position + its stable code. `axle` is an index into the plan's
/// `axles` (None for a spare, which hangs off no axle).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedPosition {
    pub axle: Option<usize>,
    pub side: Option<&'static str>,
    pub depth: Option<&'static str>,
    pub is_spare: bool,
    pub spare_index: Option<i64>,
    pub code: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChassisPlan {
    pub axles: Vec<PlannedAxle>,
    pub positions: Vec<PlannedPosition>,
}

/// Config for the generator (mirror of domain::ChassisConfig, kept here so the
/// planner is self-contained and the fuzz crate needs only this module).
#[derive(Debug, Clone, Copy)]
pub struct PlanConfig {
    pub drive_axles: i64,
    pub trailer_axles: i64,
    pub spares: i64,
    pub single_trailer_axles: bool,
}

const DUAL: [(&str, &str, &str); 4] = [
    ("left", "outer", "LO"),
    ("left", "inner", "LI"),
    ("right", "inner", "RI"),
    ("right", "outer", "RO"),
];

/// Build the plan. `Err` on a config that can't produce a legal truck
/// (< 1 drive axle, negative counts). Bounded internally so a hostile config
/// can never allocate unboundedly.
pub fn plan_chassis(cfg: &PlanConfig) -> Result<ChassisPlan, String> {
    if cfg.drive_axles < 1 || cfg.trailer_axles < 0 || cfg.spares < 0 {
        return Err("invalid chassis config".into());
    }
    // A real rig is small; cap so fuzzing can't OOM and a fat-fingered config
    // is rejected rather than generating thousands of rows.
    if cfg.drive_axles > 4 || cfg.trailer_axles > 8 || cfg.spares > 6 {
        return Err("chassis config out of range".into());
    }

    let mut axles: Vec<PlannedAxle> = Vec::new();
    let mut positions: Vec<PlannedPosition> = Vec::new();

    // Steering axle (single) — H1L / H1R.
    axles.push(PlannedAxle { section: "tractor", index: 1, axle_type: "single", is_steering: true });
    let steer_ix = axles.len() - 1;
    positions.push(PlannedPosition {
        axle: Some(steer_ix),
        side: Some("left"),
        depth: Some("single"),
        is_spare: false,
        spare_index: None,
        code: "H1L".into(),
    });
    positions.push(PlannedPosition {
        axle: Some(steer_ix),
        side: Some("right"),
        depth: Some("single"),
        is_spare: false,
        spare_index: None,
        code: "H1R".into(),
    });

    // Drive axles (dual) — H{n}{LO,LI,RI,RO}.
    for i in 0..cfg.drive_axles {
        let n = i + 2;
        axles.push(PlannedAxle { section: "tractor", index: n, axle_type: "dual", is_steering: false });
        let ax = axles.len() - 1;
        for (side, depth, suffix) in DUAL {
            positions.push(PlannedPosition {
                axle: Some(ax),
                side: Some(side),
                depth: Some(depth),
                is_spare: false,
                spare_index: None,
                code: format!("H{n}{suffix}"),
            });
        }
    }

    // Trailer axles.
    for i in 0..cfg.trailer_axles {
        let n = i + 1;
        let axle_type = if cfg.single_trailer_axles { "single" } else { "dual" };
        axles.push(PlannedAxle { section: "trailer", index: n, axle_type, is_steering: false });
        let ax = axles.len() - 1;
        if cfg.single_trailer_axles {
            for (side, suffix) in [("left", "L"), ("right", "R")] {
                positions.push(PlannedPosition {
                    axle: Some(ax),
                    side: Some(side),
                    depth: Some("single"),
                    is_spare: false,
                    spare_index: None,
                    code: format!("TR{n}{suffix}"),
                });
            }
        } else {
            for (side, depth, suffix) in DUAL {
                positions.push(PlannedPosition {
                    axle: Some(ax),
                    side: Some(side),
                    depth: Some(depth),
                    is_spare: false,
                    spare_index: None,
                    code: format!("TR{n}{suffix}"),
                });
            }
        }
    }

    // Spares — SP{n}.
    for s in 1..=cfg.spares {
        positions.push(PlannedPosition {
            axle: None,
            side: None,
            depth: None,
            is_spare: true,
            spare_index: Some(s),
            code: format!("SP{s}"),
        });
    }

    Ok(ChassisPlan { axles, positions })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn cfg(d: i64, tr: i64, sp: i64, single: bool) -> PlanConfig {
        PlanConfig { drive_axles: d, trailer_axles: tr, spares: sp, single_trailer_axles: single }
    }

    #[test]
    fn ten_wheeler_plus_dual_trailer_matches_known_codes() {
        let p = plan_chassis(&cfg(1, 2, 1, false)).unwrap();
        let codes: Vec<&str> = p.positions.iter().map(|x| x.code.as_str()).collect();
        assert_eq!(
            codes,
            vec![
                "H1L", "H1R", "H2LO", "H2LI", "H2RI", "H2RO", "TR1LO", "TR1LI", "TR1RI", "TR1RO",
                "TR2LO", "TR2LI", "TR2RI", "TR2RO", "SP1",
            ]
        );
    }

    #[test]
    fn single_trailer_axles_use_l_r_codes() {
        let p = plan_chassis(&cfg(1, 2, 0, true)).unwrap();
        let trailer: Vec<&str> = p
            .positions
            .iter()
            .filter(|x| x.code.starts_with("TR"))
            .map(|x| x.code.as_str())
            .collect();
        assert_eq!(trailer, vec!["TR1L", "TR1R", "TR2L", "TR2R"]);
    }

    #[test]
    fn rejects_illegal_and_oversized_configs() {
        assert!(plan_chassis(&cfg(0, 2, 0, false)).is_err());
        assert!(plan_chassis(&cfg(1, -1, 0, false)).is_err());
        assert!(plan_chassis(&cfg(99, 2, 0, false)).is_err());
    }

    /// The core invariants a hostile config must never break — these are the
    /// property-test assertions, run here over the whole legal grid.
    #[test]
    fn invariants_hold_across_the_legal_grid() {
        for d in 1..=4 {
            for tr in 0..=8 {
                for sp in 0..=6 {
                    for single in [false, true] {
                        let p = plan_chassis(&cfg(d, tr, sp, single)).unwrap();
                        // 1. Codes are unique.
                        let uniq: HashSet<&str> =
                            p.positions.iter().map(|x| x.code.as_str()).collect();
                        assert_eq!(uniq.len(), p.positions.len(), "duplicate code at {d},{tr},{sp}");
                        // 2. Every non-spare position points at a real axle.
                        for pos in &p.positions {
                            match pos.axle {
                                Some(ix) => assert!(ix < p.axles.len() && !pos.is_spare),
                                None => assert!(pos.is_spare),
                            }
                        }
                        // 3. Position count matches the formula exactly.
                        let expected = 2                                   // steering
                            + (d as usize) * 4                             // dual drive
                            + (tr as usize) * (if single { 2 } else { 4 }) // trailer
                            + (sp as usize); // spares
                        assert_eq!(p.positions.len(), expected, "count at {d},{tr},{sp},{single}");
                        // 4. Exactly one steering axle, and it is first.
                        assert!(p.axles[0].is_steering);
                        assert_eq!(p.axles.iter().filter(|a| a.is_steering).count(), 1);
                    }
                }
            }
        }
    }
}
