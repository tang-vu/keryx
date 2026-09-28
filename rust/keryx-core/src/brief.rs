use crate::domain::{field, str_field};
use crate::json::Result;
use serde_json::Value;

pub fn brief(result: &Value) -> Result<String> {
    let escape = |s: &str| {
        let mut x = s
            .replace('\\', "\\\\")
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;");
        for ch in ['`', '*', '_', '{', '}', '[', ']', '(', ')', '#', '!', '|'] {
            x = x.replace(ch, &format!("\\{ch}"));
        }
        let mut out = String::new();
        let mut pos = 0;
        while pos < x.len() {
            let tail = &x[pos..];
            let matched = if tail
                .get(..8)
                .is_some_and(|s| s.eq_ignore_ascii_case("https://"))
            {
                Some(8)
            } else if tail
                .get(..7)
                .is_some_and(|s| s.eq_ignore_ascii_case("http://"))
            {
                Some(7)
            } else {
                None
            };
            if let Some(len) = matched {
                out.push_str(&tail[..len - 3]);
                out.push_str("\\://");
                pos += len;
            } else {
                let ch = tail.chars().next().unwrap();
                out.push(ch);
                pos += ch.len_utf8();
            }
        }
        x = out;
        x
    };
    let answer = str_field(result, "answer")?
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let inert = answer
        .split('\n')
        .map(|line| format!("    {line}"))
        .collect::<Vec<_>>()
        .join("\n");
    let mut lines=vec!["# Private research brief".into(),"".into(),format!("Question: {}",escape(str_field(result,"question")?)),"".into(),
        format!("Saved local check: {}",str_field(result,"savedAt")?),"".into(),
        "This brief contains private research. Local receipt integrity and task binding were rechecked. The original HTTPS observation cannot be reauthenticated offline. Payment and creator settlement remain seller-reported; this is not independent settlement or factual proof.".into(),
        "".into(),"## Answer".into(),"".into(),inert,"".into()];
    if let Some(cites) = field(result, "citations")?.as_array() {
        if !cites.is_empty() {
            lines.extend(["## Cited sources in saved receipt".into(), "".into()]);
            for cite in cites {
                lines.push(format!(
                    "- {} {}",
                    escape(str_field(cite, "marker")?),
                    escape(str_field(cite, "sourceName")?)
                ));
            }
            lines.push("".into());
        }
    }
    Ok(lines.join("\n"))
}
