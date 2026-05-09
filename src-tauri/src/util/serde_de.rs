//! Lenient deserializers for Falcon's mixed JSON encoding.
//!
//! Falcon (Go + gorm) sometimes serializes numeric DB columns as JSON strings
//! (e.g. `"30.128996"` instead of `30.128996`). This typically happens when
//! the underlying Postgres column is `NUMERIC` / `DECIMAL` and Go's driver
//! routes it through a `string`-backed type for precision. Booleans and
//! integers can drift the other direction too — `0`/`1` instead of
//! `true`/`false`, `"42"` instead of `42`.
//!
//! Each helper accepts:
//!   - the canonical JSON type
//!   - a string that parses to the target type
//!   - an empty string → `None`
//!   - `null` or absent → `None`
//!
//! Use them with `#[serde(default, deserialize_with = "util::serde_de::opt_*")]`.

use serde::{Deserialize, Deserializer};
use serde_json::Value;

/* ---- f64 ---- */

pub fn opt_f64<'de, D>(deserializer: D) -> Result<Option<f64>, D::Error>
where
    D: Deserializer<'de>,
{
    let v = Option::<Value>::deserialize(deserializer)?;
    match v {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => Ok(n.as_f64()),
        Some(Value::String(s)) => parse_lenient::<f64, _>(&s, "f64"),
        Some(other) => Err(serde::de::Error::custom(format!(
            "expected number, string, or null for f64; got {}",
            type_name(&other)
        ))),
    }
}

/* ---- i32 ---- */

pub fn opt_i32<'de, D>(deserializer: D) -> Result<Option<i32>, D::Error>
where
    D: Deserializer<'de>,
{
    let v = Option::<Value>::deserialize(deserializer)?;
    match v {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => Ok(n
            .as_i64()
            .map(|i| i as i32)
            .or_else(|| n.as_f64().map(|f| f as i32))),
        Some(Value::String(s)) => parse_lenient::<i32, _>(&s, "i32"),
        Some(other) => Err(serde::de::Error::custom(format!(
            "expected number, string, or null for i32; got {}",
            type_name(&other)
        ))),
    }
}

/* ---- i64 ---- */

pub fn opt_i64<'de, D>(deserializer: D) -> Result<Option<i64>, D::Error>
where
    D: Deserializer<'de>,
{
    let v = Option::<Value>::deserialize(deserializer)?;
    match v {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => Ok(n.as_i64().or_else(|| n.as_f64().map(|f| f as i64))),
        Some(Value::String(s)) => parse_lenient::<i64, _>(&s, "i64"),
        Some(other) => Err(serde::de::Error::custom(format!(
            "expected number, string, or null for i64; got {}",
            type_name(&other)
        ))),
    }
}

/* ---- bool ---- */

pub fn opt_bool<'de, D>(deserializer: D) -> Result<Option<bool>, D::Error>
where
    D: Deserializer<'de>,
{
    let v = Option::<Value>::deserialize(deserializer)?;
    match v {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Bool(b)) => Ok(Some(b)),
        Some(Value::Number(n)) => Ok(n.as_i64().map(|i| i != 0)),
        Some(Value::String(s)) => {
            let t = s.trim().to_ascii_lowercase();
            match t.as_str() {
                "" => Ok(None),
                "true" | "1" | "yes" | "t" | "y" => Ok(Some(true)),
                "false" | "0" | "no" | "f" | "n" => Ok(Some(false)),
                _ => Err(serde::de::Error::custom(format!(
                    "could not parse bool from {s:?}"
                ))),
            }
        }
        Some(other) => Err(serde::de::Error::custom(format!(
            "expected bool, number, string, or null; got {}",
            type_name(&other)
        ))),
    }
}

/* ---- internals ---- */

fn parse_lenient<T, E>(s: &str, what: &str) -> Result<Option<T>, E>
where
    T: std::str::FromStr,
    T::Err: std::fmt::Display,
    E: serde::de::Error,
{
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    trimmed.parse::<T>().map(Some).map_err(|e| {
        E::custom(format!("could not parse {what} from {s:?}: {e}"))
    })
}

fn type_name(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

/* ---- tests ---- */

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Deserialize)]
    struct F {
        #[serde(default, deserialize_with = "opt_f64")]
        f: Option<f64>,
        #[serde(default, deserialize_with = "opt_i32")]
        i: Option<i32>,
        #[serde(default, deserialize_with = "opt_i64")]
        l: Option<i64>,
        #[serde(default, deserialize_with = "opt_bool")]
        b: Option<bool>,
    }

    fn parse(json: &str) -> F {
        serde_json::from_str(json).unwrap_or_else(|e| panic!("parse failed for {json}: {e}"))
    }

    #[test]
    fn accepts_native_json_types() {
        let v = parse(r#"{"f": 30.128996, "i": 5, "l": 99, "b": true}"#);
        assert_eq!(v.f, Some(30.128996));
        assert_eq!(v.i, Some(5));
        assert_eq!(v.l, Some(99));
        assert_eq!(v.b, Some(true));
    }

    #[test]
    fn accepts_string_encoded_numbers() {
        let v = parse(r#"{"f": "30.128996", "i": "5", "l": "99"}"#);
        assert_eq!(v.f, Some(30.128996));
        assert_eq!(v.i, Some(5));
        assert_eq!(v.l, Some(99));
    }

    #[test]
    fn accepts_string_encoded_bool() {
        assert_eq!(parse(r#"{"b": "true"}"#).b, Some(true));
        assert_eq!(parse(r#"{"b": "FALSE"}"#).b, Some(false));
        assert_eq!(parse(r#"{"b": 1}"#).b, Some(true));
        assert_eq!(parse(r#"{"b": 0}"#).b, Some(false));
    }

    #[test]
    fn null_and_empty_become_none() {
        let v = parse(r#"{"f": null, "i": "", "l": null, "b": ""}"#);
        assert_eq!(v.f, None);
        assert_eq!(v.i, None);
        assert_eq!(v.l, None);
        assert_eq!(v.b, None);
    }

    #[test]
    fn absent_fields_become_none() {
        let v = parse("{}");
        assert_eq!(v.f, None);
        assert_eq!(v.i, None);
        assert_eq!(v.l, None);
        assert_eq!(v.b, None);
    }

    #[test]
    fn rejects_unparseable_strings() {
        assert!(serde_json::from_str::<F>(r#"{"f": "not a number"}"#).is_err());
        assert!(serde_json::from_str::<F>(r#"{"b": "maybe"}"#).is_err());
    }
}
