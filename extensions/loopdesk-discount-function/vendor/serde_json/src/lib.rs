use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(i64),
    String(String),
    Array(Vec<Value>),
    Object(BTreeMap<String, Value>),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Error(String);
impl Error {
    pub fn custom(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}
impl std::error::Error for Error {}

pub trait DeserializeOwned: Sized {
    fn from_json(value: Value) -> Result<Self, Error>;
}
pub fn from_str<T: DeserializeOwned>(src: &str) -> Result<T, Error> {
    T::from_json(Parser::new(src).parse()?)
}

struct Parser<'a> {
    s: &'a [u8],
    i: usize,
}
impl<'a> Parser<'a> {
    fn new(s: &'a str) -> Self {
        Self {
            s: s.as_bytes(),
            i: 0,
        }
    }
    fn parse(mut self) -> Result<Value, Error> {
        let v = self.value()?;
        self.ws();
        if self.i == self.s.len() {
            Ok(v)
        } else {
            Err(Error::custom("trailing characters"))
        }
    }
    fn ws(&mut self) {
        while self.s.get(self.i).is_some_and(u8::is_ascii_whitespace) {
            self.i += 1;
        }
    }
    fn bump(&mut self, b: u8) -> Result<(), Error> {
        self.ws();
        if self.s.get(self.i) == Some(&b) {
            self.i += 1;
            Ok(())
        } else {
            Err(Error::custom("unexpected token"))
        }
    }
    fn value(&mut self) -> Result<Value, Error> {
        self.ws();
        match self.s.get(self.i).copied() {
            Some(b'n') => {
                self.lit(b"null")?;
                Ok(Value::Null)
            }
            Some(b't') => {
                self.lit(b"true")?;
                Ok(Value::Bool(true))
            }
            Some(b'f') => {
                self.lit(b"false")?;
                Ok(Value::Bool(false))
            }
            Some(b'\"') => Ok(Value::String(self.string()?)),
            Some(b'[') => self.array(),
            Some(b'{') => self.object(),
            Some(b'-' | b'0'..=b'9') => self.number(),
            _ => Err(Error::custom("invalid json")),
        }
    }
    fn lit(&mut self, lit: &[u8]) -> Result<(), Error> {
        if self.s.get(self.i..self.i + lit.len()) == Some(lit) {
            self.i += lit.len();
            Ok(())
        } else {
            Err(Error::custom("invalid literal"))
        }
    }
    fn string(&mut self) -> Result<String, Error> {
        self.bump(b'\"')?;
        let mut out = String::new();
        while let Some(b) = self.s.get(self.i).copied() {
            self.i += 1;
            match b {
                b'\"' => return Ok(out),
                b'\\' => {
                    let e = *self
                        .s
                        .get(self.i)
                        .ok_or_else(|| Error::custom("bad escape"))?;
                    self.i += 1;
                    out.push(match e {
                        b'\"' => '\"',
                        b'\\' => '\\',
                        b'/' => '/',
                        b'b' => '\u{0008}',
                        b'f' => '\u{000c}',
                        b'n' => '\n',
                        b'r' => '\r',
                        b't' => '\t',
                        _ => return Err(Error::custom("unsupported escape")),
                    });
                }
                _ => out.push(b as char),
            }
        }
        Err(Error::custom("unterminated string"))
    }
    fn number(&mut self) -> Result<Value, Error> {
        self.ws();
        let start = self.i;
        if self.s.get(self.i) == Some(&b'-') {
            self.i += 1;
        }
        while self.s.get(self.i).is_some_and(u8::is_ascii_digit) {
            self.i += 1;
        }
        let s =
            std::str::from_utf8(&self.s[start..self.i]).map_err(|_| Error::custom("bad number"))?;
        Ok(Value::Number(
            s.parse().map_err(|_| Error::custom("bad number"))?,
        ))
    }
    fn array(&mut self) -> Result<Value, Error> {
        self.bump(b'[')?;
        let mut a = Vec::new();
        self.ws();
        if self.s.get(self.i) == Some(&b']') {
            self.i += 1;
            return Ok(Value::Array(a));
        }
        loop {
            a.push(self.value()?);
            self.ws();
            if self.s.get(self.i) == Some(&b']') {
                self.i += 1;
                return Ok(Value::Array(a));
            }
            self.bump(b',')?;
        }
    }
    fn object(&mut self) -> Result<Value, Error> {
        self.bump(b'{')?;
        let mut o = BTreeMap::new();
        self.ws();
        if self.s.get(self.i) == Some(&b'}') {
            self.i += 1;
            return Ok(Value::Object(o));
        }
        loop {
            let k = self.string()?;
            self.bump(b':')?;
            o.insert(k, self.value()?);
            self.ws();
            if self.s.get(self.i) == Some(&b'}') {
                self.i += 1;
                return Ok(Value::Object(o));
            }
            self.bump(b',')?;
        }
    }
}
