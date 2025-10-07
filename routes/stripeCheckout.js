router.post("/create-checkout-session", async (req, res) => {
  const { email } = req.body;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: email,
      client_reference_id: email,
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      success_url: "http://localhost:5173/login", // cambia por dominio final
      cancel_url: "http://localhost:5173/register",
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("❌ Error creando sesión de Stripe:", error.message);
    res.status(500).json({ error: "Error creando sesión de pago" });
  }
});