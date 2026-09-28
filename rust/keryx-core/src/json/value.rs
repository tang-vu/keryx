use rustpython_wtf8::Wtf8Buf;
use serde_core::de::{self, Deserialize, Deserializer, MapAccess, Visitor};
use serde_json::value::RawValue;
use std::{
    collections::HashMap,
    fmt,
    ops::{Index, IndexMut},
};

use super::Result;

// The reader has a stricter per-file bound (8 KB, 64 KB, 150 KB, or 2 MB).
// These parser limits bound recursive materialization and output formatting.
pub(super) const MAX_BYTES: usize = 2_000_000;
pub(super) const MAX_DEPTH: usize = 128;
pub(super) const MAX_NODES: usize = 200_000;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct JsString(pub(super) Wtf8Buf);

impl JsString {
    pub fn as_str(&self) -> Option<&str> {
        self.0.as_str().ok()
    }
    pub fn to_string_lossy(&self) -> std::borrow::Cow<'_, str> {
        self.0.to_string_lossy()
    }
    pub fn utf16_len(&self) -> usize {
        self.0.encode_wide().count()
    }
    pub fn utf16_units(&self) -> impl Iterator<Item = u16> + '_ {
        self.0.encode_wide()
    }
    pub fn trim_matches(&self, f: impl Fn(char) -> bool) -> Self {
        Self(
            self.0
                .trim_matches(|cp| cp.to_char().is_some_and(&f))
                .to_wtf8_buf(),
        )
    }
}
impl From<&str> for JsString {
    fn from(value: &str) -> Self {
        Self(Wtf8Buf::from_string(value.to_owned()))
    }
}
impl From<String> for JsString {
    fn from(value: String) -> Self {
        Self(Wtf8Buf::from_string(value))
    }
}
impl PartialEq<str> for JsString {
    fn eq(&self, other: &str) -> bool {
        self.as_str() == Some(other)
    }
}
impl PartialEq<&str> for JsString {
    fn eq(&self, other: &&str) -> bool {
        self == *other
    }
}

// serde_json documents this byte path as WTF-8 for escaped lone surrogates.
// It also works for object keys through serde_json's MapKey deserializer.
impl<'de> Deserialize<'de> for JsString {
    fn deserialize<D: Deserializer<'de>>(de: D) -> std::result::Result<Self, D::Error> {
        struct Bytes;
        impl<'de> Visitor<'de> for Bytes {
            type Value = JsString;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a JSON string as WTF-8 bytes")
            }
            fn visit_bytes<E: de::Error>(self, v: &[u8]) -> std::result::Result<JsString, E> {
                self.visit_byte_buf(v.to_vec())
            }
            fn visit_borrowed_bytes<E: de::Error>(
                self,
                v: &'de [u8],
            ) -> std::result::Result<JsString, E> {
                self.visit_bytes(v)
            }
            fn visit_byte_buf<E: de::Error>(self, v: Vec<u8>) -> std::result::Result<JsString, E> {
                Wtf8Buf::from_bytes(v)
                    .map(JsString)
                    .map_err(|_| E::custom("invalid WTF-8"))
            }
        }
        de.deserialize_byte_buf(Bytes)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    String(JsString),
    Array(Vec<Self>),
    Object(Vec<(JsString, Self)>),
}
impl Value {
    pub fn object(entries: Vec<(&str, Self)>) -> Self {
        Self::Object(
            entries
                .into_iter()
                .map(|(k, v)| (JsString::from(k), v))
                .collect(),
        )
    }
    pub fn get(&self, key: &str) -> Option<&Self> {
        match self {
            Self::Object(xs) => xs.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
    pub fn pointer(&self, path: &str) -> Option<&Self> {
        if path.is_empty() {
            return Some(self);
        }
        let mut current = self;
        for part in path.strip_prefix('/')?.split('/') {
            let part = part.replace("~1", "/").replace("~0", "~");
            current = match current {
                Self::Array(xs) => xs.get(part.parse::<usize>().ok()?),
                _ => current.get(&part),
            }?;
        }
        Some(current)
    }
    pub fn as_js_string(&self) -> Option<&JsString> {
        match self {
            Self::String(v) => Some(v),
            _ => None,
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        self.as_js_string()?.as_str()
    }
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Self::Number(v) => Some(*v),
            _ => None,
        }
    }
    pub fn as_array(&self) -> Option<&[Self]> {
        match self {
            Self::Array(v) => Some(v),
            _ => None,
        }
    }
    pub fn as_object(&self) -> Option<&[(JsString, Self)]> {
        match self {
            Self::Object(v) => Some(v),
            _ => None,
        }
    }
    pub fn is_null(&self) -> bool {
        matches!(self, Self::Null)
    }
    pub fn is_string(&self) -> bool {
        matches!(self, Self::String(_))
    }
    pub fn is_boolean(&self) -> bool {
        matches!(self, Self::Bool(_))
    }
}
impl From<&str> for Value {
    fn from(v: &str) -> Self {
        Self::String(JsString::from(v))
    }
}
impl From<String> for Value {
    fn from(v: String) -> Self {
        Self::String(JsString::from(v))
    }
}
impl From<&String> for Value {
    fn from(v: &String) -> Self {
        Self::from(v.as_str())
    }
}
impl From<&JsString> for Value {
    fn from(v: &JsString) -> Self {
        Self::String(v.clone())
    }
}
impl From<bool> for Value {
    fn from(v: bool) -> Self {
        Self::Bool(v)
    }
}
impl From<u64> for Value {
    fn from(v: u64) -> Self {
        Self::Number(v as f64)
    }
}
impl From<Option<&str>> for Value {
    fn from(v: Option<&str>) -> Self {
        v.map_or(Self::Null, Self::from)
    }
}
impl From<serde_json::Value> for Value {
    fn from(v: serde_json::Value) -> Self {
        match v {
            serde_json::Value::Null => Self::Null,
            serde_json::Value::Bool(v) => Self::Bool(v),
            serde_json::Value::Number(v) => Self::Number(v.as_f64().unwrap()),
            serde_json::Value::String(v) => Self::from(v),
            serde_json::Value::Array(v) => Self::Array(v.into_iter().map(Self::from).collect()),
            serde_json::Value::Object(v) => Self::Object(
                v.into_iter()
                    .map(|(k, v)| (JsString::from(k), Self::from(v)))
                    .collect(),
            ),
        }
    }
}
impl Index<&str> for Value {
    type Output = Self;
    fn index(&self, key: &str) -> &Self {
        self.get(key).expect("missing JSON field")
    }
}
impl IndexMut<&str> for Value {
    fn index_mut(&mut self, key: &str) -> &mut Self {
        match self {
            Self::Object(xs) => {
                &mut xs
                    .iter_mut()
                    .find(|(k, _)| k == key)
                    .expect("missing JSON field")
                    .1
            }
            _ => panic!("expected JSON object"),
        }
    }
}
impl Index<usize> for Value {
    type Output = Self;
    fn index(&self, index: usize) -> &Self {
        &self.as_array().expect("expected JSON array")[index]
    }
}
impl PartialEq<&str> for Value {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == Some(*other)
    }
}

struct Pairs<'a>(Vec<(JsString, &'a RawValue)>);
impl<'de> Deserialize<'de> for Pairs<'de> {
    fn deserialize<D: Deserializer<'de>>(de: D) -> std::result::Result<Self, D::Error> {
        struct PairVisitor;
        impl<'de> Visitor<'de> for PairVisitor {
            type Value = Pairs<'de>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a JSON object")
            }
            fn visit_map<M: MapAccess<'de>>(
                self,
                mut map: M,
            ) -> std::result::Result<Self::Value, M::Error> {
                let mut pairs = Vec::new();
                while let Some(pair) = map.next_entry::<JsString, &'de RawValue>()? {
                    pairs.push(pair);
                }
                Ok(Pairs(pairs))
            }
        }
        de.deserialize_map(PairVisitor)
    }
}

pub fn parse(text: &str) -> Result<Value> {
    if text.len() > MAX_BYTES {
        return Err("local JSON exceeds parser limit".into());
    }
    // RawValue runs serde_json's grammar before the permissive byte-string path.
    let raw: &RawValue = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let mut nodes = 0;
    parse_raw(raw, 0, &mut nodes)
}
fn parse_raw(raw: &RawValue, depth: usize, nodes: &mut usize) -> Result<Value> {
    if depth > MAX_DEPTH {
        return Err("local JSON exceeds nesting limit".into());
    }
    *nodes += 1;
    if *nodes > MAX_NODES {
        return Err("local JSON exceeds value limit".into());
    }
    let text = raw.get();
    let token = text
        .trim_start()
        .as_bytes()
        .first()
        .ok_or("empty JSON value")?;
    match token {
        b'"' => serde_json::from_str::<JsString>(text)
            .map(Value::String)
            .map_err(|e| e.to_string()),
        b'{' => {
            let Pairs(pairs) =
                serde_json::from_str::<Pairs<'_>>(text).map_err(|e| e.to_string())?;
            let mut entries: Vec<(JsString, Value)> = Vec::new();
            let mut positions: HashMap<JsString, usize> = HashMap::new();
            for (key, child) in pairs {
                // Parse overwritten values too; JSON.parse validates the whole input.
                let value = parse_raw(child, depth + 1, nodes)?;
                if let Some(&position) = positions.get(&key) {
                    entries[position].1 = value;
                } else {
                    positions.insert(key.clone(), entries.len());
                    entries.push((key, value));
                }
            }
            Ok(Value::Object(entries))
        }
        b'[' => {
            let children: Vec<&RawValue> = serde_json::from_str(text).map_err(|e| e.to_string())?;
            let mut values = Vec::with_capacity(children.len());
            for child in children {
                values.push(parse_raw(child, depth + 1, nodes)?);
            }
            Ok(Value::Array(values))
        }
        b't' | b'f' => serde_json::from_str::<bool>(text)
            .map(Value::Bool)
            .map_err(|e| e.to_string()),
        b'n' => serde_json::from_str::<()>(text)
            .map(|_| Value::Null)
            .map_err(|e| e.to_string()),
        _ => {
            let number = serde_json::from_str::<serde_json::Number>(text)
                .ok()
                .and_then(|n| n.as_f64())
                .or_else(|| text.trim().parse::<f64>().ok())
                .ok_or("invalid JSON number")?;
            Ok(Value::Number(number))
        }
    }
}
