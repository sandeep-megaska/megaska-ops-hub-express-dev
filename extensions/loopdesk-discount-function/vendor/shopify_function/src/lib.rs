pub use shopify_function_macros::shopify_function;
pub type Result<T> = core::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
pub mod prelude { pub use crate::shopify_function; }
