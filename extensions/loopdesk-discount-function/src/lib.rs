use shopify_function::prelude::*;

#[typegen("./schema.graphql")]
pub mod schema {
    #[query("./src/cart_lines_discounts_generate_run.graphql")]
    pub mod cart_lines_discounts_generate_run {}
}

pub mod cart_lines_discounts_generate_run;
pub mod config;
pub mod decimal;
pub mod eligibility;
pub mod rewards;

pub use cart_lines_discounts_generate_run::run;
