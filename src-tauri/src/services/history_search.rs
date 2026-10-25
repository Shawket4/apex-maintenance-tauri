//! The AI search box: which backend answers, and the mapping of each reply.
//!
//! Two backends, one box:
//!   * apex-rust's advisor search (`POST /api/rust/api/v1/advisor/search`,
//!     permission 1+): Claude expands the words into variants, then a hybrid
//!     vector + keyword search ranks service lines. This answers "find the
//!     service history" questions — "last oil change on 5139", "all brake
//!     work in the last two months".
//!   * maint-rust's `/ai/query` (permission 3+): Claude writes SQL over
//!     Falcon's DB. Kept for free-form fleet questions the hit list cannot
//!     answer — counts, totals, rankings ("which truck changed the most
//!     tires this year?") — and as the fallback when the advisor fails or
//!     finds nothing, so the box never gets worse than it was.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;

use crate::AppResult;

/// apex-rust path under `rust_prefix`.
pub const ADVISOR_SEARCH_PATH: &str = "/api/v1/advisor/search";
/// Hits requested from the advisor (its own default; server clamps 1..=100).
pub const ADVISOR_LIMIT: usize = 30;

/// Which backend a query goes to first.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    /// Find service lines — advisor first, `/ai/query` as the fallback.
    History,
    /// Aggregate / free-form fleet question — `/ai/query` only.
    Question,
}

/// Words that mark a question the advisor's hit list can't answer: counts,
/// sums, costs, rankings. Matched word by word on the normalised query (see
/// `normalise`); a trailing `*` is a prefix match ("تكلف*" = تكلفة, تكلفه…),
/// otherwise the word must match exactly — so "كام" (how many/much) never
/// fires on "كاملة" (complete), nor "top" on "stop".
const QUESTION_MARKERS: &[&[&str]] = &[
    &["كام"],
    &["عدد"],
    &["اكتر"],
    &["اكثر"],
    &["اقل"],
    &["متوسط*"],
    &["اجمالي*"],
    &["مجموع*"],
    &["تكلف*"],
    &["مصاريف"],
    &["قارن*"],
    &["ترتيب"],
    &["انهي", "عربي*"],
    &["اي", "عربي*"],
    &["how", "many"],
    &["how", "much"],
    &["most"],
    &["least"],
    &["average"],
    &["avg"],
    &["total"],
    &["count"],
    &["sum"],
    &["which", "truck*"],
    &["which", "vehicle*"],
    &["which", "car*"],
    &["cost*"],
    &["spent"],
    &["spend*"],
    &["compare"],
    &["top"],
    &["rank*"],
];

/// Arabic clitics stripped before matching ("بكام" → "كام", "الأكتر" → "اكتر").
const AR_PREFIXES: &[&str] = &["وال", "بال", "فال", "لل", "ال", "و", "ب", "ف"];

/// Arabic letter folding (أ/إ/آ → ا, ة → ه, ى → ي, drop tatweel and
/// diacritics) + lowercase, so markers match however the query is typed.
fn normalise(q: &str) -> String {
    q.chars()
        .filter_map(|c| match c {
            'أ' | 'إ' | 'آ' => Some('ا'),
            'ة' => Some('ه'),
            'ى' => Some('ي'),
            'ـ' => None,
            '\u{064B}'..='\u{0652}' => None,
            c => Some(c),
        })
        .flat_map(char::to_lowercase)
        .collect()
}

fn word_matches(token: &str, pattern: &str) -> bool {
    let mut forms = std::iter::once(token)
        .chain(AR_PREFIXES.iter().filter_map(|p| token.strip_prefix(p)))
        .filter(|f| !f.is_empty());
    match pattern.strip_suffix('*') {
        Some(stem) => forms.any(|f| f.starts_with(stem)),
        None => forms.any(|f| f == pattern),
    }
}

pub fn route(query: &str) -> Route {
    let q = normalise(query);
    let words: Vec<&str> = q
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect();
    let question = QUESTION_MARKERS.iter().any(|m| {
        words
            .windows(m.len())
            .any(|w| w.iter().zip(m.iter()).all(|(t, p)| word_matches(t, p)))
    });
    if question {
        Route::Question
    } else {
        Route::History
    }
}

/// One service line the advisor found.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
pub struct HistoryHit {
    pub invoice_id: i64,
    pub item_id: Option<i64>,
    pub car_id: Option<i64>,
    pub plate_number: Option<String>,
    /// RFC 3339 (apex-rust serialises a UTC `DateTime`).
    pub date: Option<String>,
    /// Odometer (km) on the invoice.
    pub meter_reading: Option<i64>,
    pub service: String,
    pub notes: Option<String>,
    pub score: Option<f64>,
    /// Which variants found it, and how ("… (vector)" / "… (keyword)").
    pub matched: Vec<String>,
}

/// apex-rust `search::Hit` as it arrives — lenient (missing → None/empty).
#[derive(Debug, Deserialize)]
struct WireHit {
    invoice_id: i64,
    item_id: Option<i64>,
    car_id: Option<i64>,
    plate_number: Option<String>,
    date: Option<String>,
    meter_reading: Option<i64>,
    #[serde(default)]
    service: Option<String>,
    notes: Option<String>,
    score: Option<f64>,
    #[serde(default)]
    matched: Option<Vec<String>>,
}

impl From<WireHit> for HistoryHit {
    fn from(w: WireHit) -> Self {
        let blank = |s: Option<String>| s.filter(|v| !v.trim().is_empty());
        Self {
            invoice_id: w.invoice_id,
            item_id: w.item_id,
            car_id: w.car_id,
            plate_number: blank(w.plate_number),
            date: blank(w.date),
            meter_reading: w.meter_reading,
            service: w.service.unwrap_or_default(),
            notes: blank(w.notes),
            score: w.score,
            matched: w.matched.unwrap_or_default(),
        }
    }
}

/// apex-rust's `search_history` reply (handlers.rs): `{query, variants,
/// plate_number, count, hits}`.
#[derive(Debug, Deserialize)]
struct AdvisorReply {
    #[serde(default)]
    variants: Option<Vec<String>>,
    #[serde(default)]
    plate_number: Option<String>,
    hits: Vec<WireHit>,
}

/// Why the `/ai/query` answer is shown instead of the advisor's.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum FallbackReason {
    /// Advisor unreachable, refused, or replied with something unparseable.
    AdvisorError,
    /// Advisor answered but found nothing.
    NoHits,
}

/// What the search box renders.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(tag = "source", rename_all = "snake_case")]
pub enum AiSearchResult {
    Advisor {
        /// The phrasings Claude searched for.
        variants: Vec<String>,
        /// The plate the search was narrowed to, if any.
        plate_number: Option<String>,
        hits: Vec<HistoryHit>,
    },
    AiQuery {
        answer: String,
        rows: Vec<Value>,
        /// Set when this came from the fallback, not the router.
        fallback: Option<FallbackReason>,
    },
}

pub fn advisor_request(query: &str) -> Value {
    serde_json::json!({ "query": query, "limit": ADVISOR_LIMIT })
}

pub fn parse_advisor(body: &str) -> AppResult<AiSearchResult> {
    let r: AdvisorReply = serde_json::from_str(body)?;
    Ok(AiSearchResult::Advisor {
        variants: r.variants.unwrap_or_default(),
        plate_number: r.plate_number.filter(|p| !p.trim().is_empty()),
        hits: r.hits.into_iter().map(HistoryHit::from).collect(),
    })
}

/// maint-rust `/ai/query` reply: `{answer, rows}`, read leniently.
pub fn parse_ai_query(body: &str, fallback: Option<FallbackReason>) -> AppResult<AiSearchResult> {
    let v: Value = serde_json::from_str(body)?;
    let answer = v
        .get("answer")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let rows = v
        .get("rows")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(AiSearchResult::AiQuery {
        answer,
        rows,
        fallback,
    })
}

/// Route, call, fall back. `advisor` and `ai_query` return the raw response
/// body; they're injected so the policy is testable without a server.
///
///   * Question → `/ai/query` only (advisor never called).
///   * History  → advisor. On any advisor error (network, 401/403/5xx, bad
///     JSON) → `/ai/query`, whose own error is what the user sees (exactly
///     the old behaviour). On zero hits → `/ai/query`; if that fails too the
///     empty advisor result is shown rather than an error.
pub async fn search<A, AF, Q, QF>(query: &str, advisor: A, ai_query: Q) -> AppResult<AiSearchResult>
where
    A: FnOnce() -> AF,
    AF: std::future::Future<Output = AppResult<String>>,
    Q: FnOnce() -> QF,
    QF: std::future::Future<Output = AppResult<String>>,
{
    if route(query) == Route::Question {
        return parse_ai_query(&ai_query().await?, None);
    }
    match advisor().await.and_then(|body| parse_advisor(&body)) {
        Ok(found) => {
            let empty = matches!(&found, AiSearchResult::Advisor { hits, .. } if hits.is_empty());
            if !empty {
                return Ok(found);
            }
            match ai_query()
                .await
                .and_then(|b| parse_ai_query(&b, Some(FallbackReason::NoHits)))
            {
                Ok(r) => Ok(r),
                Err(e) => {
                    tracing::info!(error = ?e, "ai/query fallback failed after empty advisor search");
                    Ok(found)
                }
            }
        }
        Err(e) => {
            tracing::warn!(error = ?e, "advisor search failed; falling back to ai/query");
            parse_ai_query(&ai_query().await?, Some(FallbackReason::AdvisorError))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AppError;
    use std::cell::Cell;

    const ADVISOR_BODY: &str = r#"{
        "query": "تيل فرامل 8351",
        "variants": ["تيل فرامل", "brake pads"],
        "plate_number": "8351",
        "count": 1,
        "hits": [{
            "item_id": 77, "invoice_id": 1201, "car_id": 42,
            "plate_number": "ط ر ب 8351", "date": "2026-05-01T09:30:00Z",
            "meter_reading": 412300, "service": "تغيير تيل فرامل أمامي",
            "notes": "دسك سليم", "score": 0.031, "matched": ["تيل فرامل (vector)"]
        }]
    }"#;

    #[test]
    fn routes_aggregates_to_ai_query() {
        for q in [
            "أنهي عربية غيّرت كاوتش أكتر حاجة السنة دي؟",
            "كام مرة غيرنا زيت للعربية 5139",
            "اجمالي تكلفة الصيانة الشهر ده",
            "How many oil changes last month?",
            "Which truck spent the most on tires",
            "بكام تغيير الزيت؟",
            "مين الأكتر في تغيير الكاوتش",
        ] {
            assert_eq!(route(q), Route::Question, "{q}");
        }
    }

    #[test]
    fn routes_lookups_to_advisor() {
        for q in [
            "امتى آخر تغيير زيت للعربية 5139؟",
            "كل شغل الفرامل الشهرين اللي فاتوا",
            "تيل فرامل 8351",
            "When was the last oil change for truck 5139?",
            "brake stop light",   // "top" inside "stop" is not a marker
            "تغيير كامل للفرامل", // "كامل" is not "كام"
        ] {
            assert_eq!(route(q), Route::History, "{q}");
        }
    }

    #[test]
    fn maps_advisor_reply() {
        let r = parse_advisor(ADVISOR_BODY).unwrap();
        let AiSearchResult::Advisor {
            variants,
            plate_number,
            hits,
        } = r
        else {
            panic!("expected advisor result")
        };
        assert_eq!(variants, vec!["تيل فرامل", "brake pads"]);
        assert_eq!(plate_number.as_deref(), Some("8351"));
        assert_eq!(hits.len(), 1);
        let h = &hits[0];
        assert_eq!(h.invoice_id, 1201);
        assert_eq!(h.item_id, Some(77));
        assert_eq!(h.car_id, Some(42));
        assert_eq!(h.plate_number.as_deref(), Some("ط ر ب 8351"));
        assert_eq!(h.date.as_deref(), Some("2026-05-01T09:30:00Z"));
        assert_eq!(h.meter_reading, Some(412300));
        assert_eq!(h.service, "تغيير تيل فرامل أمامي");
        assert_eq!(h.notes.as_deref(), Some("دسك سليم"));
        assert_eq!(h.matched, vec!["تيل فرامل (vector)"]);
    }

    #[test]
    fn advisor_nulls_and_missing_fields_are_tolerated() {
        let body = r#"{"query":"x","variants":null,"plate_number":"  ","count":1,"hits":[
            {"invoice_id":5,"car_id":null,"plate_number":null,"date":null,
             "meter_reading":null,"service":"زيت","notes":null}]}"#;
        let AiSearchResult::Advisor {
            variants,
            plate_number,
            hits,
        } = parse_advisor(body).unwrap()
        else {
            panic!()
        };
        assert!(variants.is_empty());
        assert_eq!(plate_number, None, "blank plate is no plate");
        assert_eq!(hits[0].invoice_id, 5);
        assert_eq!(hits[0].car_id, None);
        assert!(hits[0].matched.is_empty());
    }

    #[test]
    fn advisor_error_body_is_an_error() {
        assert!(parse_advisor(r#"{"error":"forbidden"}"#).is_err());
        assert!(parse_advisor("<html>502</html>").is_err());
    }

    #[test]
    fn maps_ai_query_reply() {
        let r = parse_ai_query(r#"{"answer":"آخر مرة","rows":[{"a":1}]}"#, None).unwrap();
        assert_eq!(
            r,
            AiSearchResult::AiQuery {
                answer: "آخر مرة".into(),
                rows: vec![serde_json::json!({"a":1})],
                fallback: None
            }
        );
        // Lenient: missing fields become empty, not an error.
        let r = parse_ai_query("{}", Some(FallbackReason::NoHits)).unwrap();
        assert_eq!(
            r,
            AiSearchResult::AiQuery {
                answer: String::new(),
                rows: vec![],
                fallback: Some(FallbackReason::NoHits)
            }
        );
    }

    #[test]
    fn serialises_with_source_tag() {
        let v = serde_json::to_value(parse_advisor(ADVISOR_BODY).unwrap()).unwrap();
        assert_eq!(v["source"], "advisor");
        assert_eq!(v["hits"][0]["meter_reading"], 412300);
        let v =
            serde_json::to_value(parse_ai_query("{}", Some(FallbackReason::AdvisorError)).unwrap())
                .unwrap();
        assert_eq!(v["source"], "ai_query");
        assert_eq!(v["fallback"], "advisor_error");
    }

    const AI_BODY: &str = r#"{"answer":"from ai","rows":[]}"#;

    #[tokio::test]
    async fn history_uses_advisor_and_skips_ai_query() {
        let ai_called = Cell::new(false);
        let r = search(
            "تيل فرامل 8351",
            || async { Ok(ADVISOR_BODY.to_string()) },
            || async {
                ai_called.set(true);
                Ok(AI_BODY.to_string())
            },
        )
        .await
        .unwrap();
        assert!(matches!(r, AiSearchResult::Advisor { ref hits, .. } if hits.len() == 1));
        assert!(!ai_called.get());
    }

    #[tokio::test]
    async fn question_skips_advisor() {
        let adv_called = Cell::new(false);
        let r = search(
            "كام مرة غيرنا زيت",
            || async {
                adv_called.set(true);
                Ok(ADVISOR_BODY.to_string())
            },
            || async { Ok(AI_BODY.to_string()) },
        )
        .await
        .unwrap();
        assert!(matches!(r, AiSearchResult::AiQuery { fallback: None, .. }));
        assert!(!adv_called.get());
    }

    #[tokio::test]
    async fn advisor_error_falls_back() {
        for err in [
            AppError::Offline("connection refused".into()),
            AppError::Unauthorized,
            AppError::Http("403 Forbidden".into()),
        ] {
            let r = search(
                "تيل فرامل",
                || async { Err(err) },
                || async { Ok(AI_BODY.to_string()) },
            )
            .await
            .unwrap();
            assert_eq!(
                r,
                AiSearchResult::AiQuery {
                    answer: "from ai".into(),
                    rows: vec![],
                    fallback: Some(FallbackReason::AdvisorError)
                }
            );
        }
    }

    #[tokio::test]
    async fn advisor_garbage_falls_back() {
        let r = search(
            "تيل فرامل",
            || async { Ok("<html>bad gateway</html>".to_string()) },
            || async { Ok(AI_BODY.to_string()) },
        )
        .await
        .unwrap();
        assert!(matches!(
            r,
            AiSearchResult::AiQuery {
                fallback: Some(FallbackReason::AdvisorError),
                ..
            }
        ));
    }

    #[tokio::test]
    async fn both_failing_surfaces_ai_query_error() {
        let r = search(
            "تيل فرامل",
            || async { Err(AppError::Offline("down".into())) },
            || async { Err(AppError::Http("500 — ANTHROPIC_API_KEY not set".into())) },
        )
        .await;
        let e = r.unwrap_err();
        assert!(
            e.to_string().contains("ANTHROPIC"),
            "old error preserved: {e}"
        );
    }

    #[tokio::test]
    async fn no_hits_falls_back_but_keeps_empty_result_if_ai_fails() {
        let empty = r#"{"query":"x","variants":["x"],"count":0,"hits":[]}"#;
        let r = search(
            "تيل",
            || async { Ok(empty.to_string()) },
            || async { Ok(AI_BODY.to_string()) },
        )
        .await
        .unwrap();
        assert!(matches!(
            r,
            AiSearchResult::AiQuery {
                fallback: Some(FallbackReason::NoHits),
                ..
            }
        ));

        let r = search(
            "تيل",
            || async { Ok(empty.to_string()) },
            || async { Err(AppError::Http("403 — permission >= 3".into())) },
        )
        .await
        .unwrap();
        assert!(matches!(r, AiSearchResult::Advisor { ref hits, .. } if hits.is_empty()));
    }
}
