fetch("data/demo.json")
  .then(res => res.json())
  .then(data => {
    document.getElementById("news-cards").innerHTML = "News system connected ✔";
    document.getElementById("order-paper").innerHTML = "Legislation system connected ✔";
    document.getElementById("economy").innerHTML = "Economy system connected ✔";
  });
