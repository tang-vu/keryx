use serde::Deserialize;
use std::io::{BufRead, Write};

pub const MAX_REQUEST_FRAME: usize = 128 * 1024;
pub const MAX_RESPONSE_FRAME: usize = 16 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reply {
    pub id: u64,
    pub ok: bool,
    pub result: Option<String>,
    pub error: Option<String>,
}

pub fn frame(id: u64, action: &str, payload: &str) -> Result<Vec<u8>, String> {
    let mut output = serde_json::to_vec(&serde_json::json!({
        "id": id,
        "action": action,
        "payload": payload,
    }))
    .map_err(|_| "Could not encode helper request")?;
    output.push(b'\n');
    if output.len() > MAX_REQUEST_FRAME {
        return Err("Helper request exceeds its size limit".into());
    }
    Ok(output)
}

pub fn read_frame<R: BufRead>(reader: &mut R) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    loop {
        let available = reader
            .fill_buf()
            .map_err(|_| "Helper output could not be read")?;
        if available.is_empty() {
            return Err("Helper closed before answering".into());
        }
        if let Some(index) = available.iter().position(|byte| *byte == b'\n') {
            if output.len() + index > MAX_RESPONSE_FRAME {
                return Err("Helper response exceeds its size limit".into());
            }
            output.extend_from_slice(&available[..index]);
            reader.consume(index + 1);
            return Ok(output);
        }
        if output.len() + available.len() > MAX_RESPONSE_FRAME {
            return Err("Helper response exceeds its size limit".into());
        }
        let count = available.len();
        output.extend_from_slice(available);
        reader.consume(count);
    }
}

pub fn parse_reply(bytes: &[u8], expected_id: u64) -> Result<Result<String, String>, String> {
    if bytes.contains(&0) {
        return Err("Invalid helper response frame".into());
    }
    let response: Reply =
        serde_json::from_slice(bytes).map_err(|_| "Invalid helper response envelope")?;
    if response.id != expected_id {
        return Err("Unexpected helper response identifier".into());
    }
    match (response.ok, response.result, response.error) {
        (true, Some(result), None) if result.len() <= MAX_RESPONSE_FRAME => Ok(Ok(result)),
        (false, None, Some(error)) if error.len() <= 2048 => Ok(Err(error)),
        _ => Err("Invalid helper response shape".into()),
    }
}

pub fn exchange<W: Write, R: BufRead>(
    writer: &mut W,
    reader: &mut R,
    id: u64,
    action: &str,
    payload: &str,
) -> Result<Result<String, String>, String> {
    writer
        .write_all(&frame(id, action, payload)?)
        .map_err(|_| "Could not send helper request")?;
    writer
        .flush()
        .map_err(|_| "Could not flush helper request")?;
    parse_reply(&read_frame(reader)?, id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn preserves_opaque_legacy_json_escape() {
        let frame = br#"{"id":1,"ok":true,"result":"{\"answer\":\"\\ud800\"}"}"#;
        assert_eq!(
            parse_reply(frame, 1).unwrap().unwrap(),
            r#"{"answer":"\ud800"}"#
        );
    }

    #[test]
    fn refuses_wrong_id_and_malformed_shape() {
        assert!(parse_reply(br#"{"id":2,"ok":true,"result":"null"}"#, 1).is_err());
        assert!(parse_reply(br#"{"id":1,"ok":true,"result":"null","error":"x"}"#, 1).is_err());
    }

    #[test]
    fn refuses_unbounded_unterminated_output() {
        let source = vec![b'x'; MAX_RESPONSE_FRAME + 1];
        assert!(read_frame(&mut Cursor::new(source)).is_err());
    }

    #[test]
    fn single_frame_exchange() {
        let mut sent = Vec::new();
        let mut received = Cursor::new(b"{\"id\":1,\"ok\":true,\"result\":\"null\"}\n".to_vec());
        assert_eq!(
            exchange(&mut sent, &mut received, 1, "refresh", "{}")
                .unwrap()
                .unwrap(),
            "null"
        );
        assert!(String::from_utf8(sent).unwrap().contains("refresh"));
    }
}
