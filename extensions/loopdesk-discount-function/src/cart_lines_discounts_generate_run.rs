#[derive(Clone, Debug, PartialEq)]
pub struct Input {
    pub cart: Cart,
    pub discount: Discount,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Cart {
    pub cost: CartCost,
    pub lines: Vec<CartLine>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CartCost {
    pub subtotal_amount: MoneyV2,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MoneyV2 {
    pub amount: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CartLine {
    pub id: String,
    pub quantity: i64,
    pub cost: CartLineCost,
    pub promotion_rule_id: Option<Attribute>,
    pub promotion_compilation_version: Option<Attribute>,
    pub merchandise: Merchandise,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CartLineCost {
    pub amount_per_quantity: MoneyV2,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Attribute {
    pub value: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Merchandise {
    ProductVariant { id: String, product: Product },
    Other,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Product {
    pub id: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Discount {
    pub discount_classes: Vec<DiscountClass>,
    pub configuration: Option<Metafield>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum DiscountClass {
    Product,
    Order,
    Shipping,
    Unknown,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Metafield {
    pub value: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CartLinesDiscountsGenerateRunResult {
    pub operations: Vec<Operation>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Operation {}
