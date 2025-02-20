require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const { createCanvas, loadImage } = require("canvas");
const { CohereClient } = require("cohere-ai");
const app = express();
const FormData = require("form-data");
const fetch = require("node-fetch");
const cron = require("node-cron");

const PORT = process.env.PORT || 3000;
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;
const INSTAGRAM_ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const INSTAGRAM_ACCOUNT_ID = process.env.INSTAGRAM_ACCOUNT_ID;
const IMAGE_API_KEY = process.env.IMAGE_API_KEY;
const COHERE_API_KEY = process.env.COHERE_API_KEY;
const IMAGE_API_URL =
  "https://api.stability.ai/v2beta/stable-image/generate/ultra";

const cohere = new CohereClient({
  token: COHERE_API_KEY,
});

app.use(cors());
app.use(express.json());
app.use("/images", express.static(path.join(__dirname, "images"))); // 📌 Görselleri erişilebilir yap

async function shareOnInstagram(imageUrl, caption) {
  try {
    // 1️⃣ Görseli Instagram Medya Nesnesi olarak oluştur

    const mediaResponse = await fetch(
      `https://graph.facebook.com/v19.0/${INSTAGRAM_ACCOUNT_ID}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: imageUrl,
          caption: caption,
          access_token: INSTAGRAM_ACCESS_TOKEN,
        }),
      }
    );

    const mediaData = await mediaResponse.json();
    console.log("mediaData", mediaData);
    if (!mediaData.id) throw new Error("❌ Media upload failed!");

    // 2️⃣ Paylaşımı yayına al
    const publishResponse = await fetch(
      `https://graph.facebook.com/v19.0/${INSTAGRAM_ACCOUNT_ID}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creation_id: mediaData.id,
          access_token: INSTAGRAM_ACCESS_TOKEN,
        }),
      }
    );

    const publishData = await publishResponse.json();
    if (!publishData.id) throw new Error("❌ Instagram publish failed!");

    console.log("✅ Instagram post successfully published!", publishData);
    return publishData;
  } catch (error) {
    console.error("❌ Error posting to Instagram:", error.message);
    return null;
  }
}

// 📌 **Gerçekçi Görsel Açıklaması Oluşturma**
// 📌 **Gerçekçi Görsel Açıklaması Oluşturma (Yaratıcı ve Detaylı)**
async function generateImagePrompt(motivationQuote) {
  try {
    // 🔥 AI'yi yaratıcı ve özgür bırak, ancak çıktının İngilizce olmasını zorunlu kıl
    const freeformPrompt = await cohere.generate({
      model: "command-r-plus",
      prompt: `Create a cinematic and abstract visual description inspired by the following motivational quote. 
      - Do not follow predefined categories, but generate a scene that captures the essence and emotion of the quote in a completely creative way.  
      - Let the image be unpredictable, unique, and visually stimulating.  
      - The description must be strictly in **English**.  

      Quote: "${motivationQuote}"  
      Visual Description:`, // İngilizceyi zorunlu kılmak için açık bir yönerge eklendi.

      max_tokens: 100,
      temperature: 0.8, // Daha yaratıcı sonuçlar almak için yüksek sıcaklık
    });

    console.log(freeformPrompt);

    // ❗ API'nin geçerli bir yanıt döndürdüğünden emin ol
    if (
      !freeformPrompt.generations ||
      freeformPrompt.generations.length === 0
    ) {
      console.error("❌ Cohere API did not return a valid response.");
      return "A surreal and breathtaking scene, embodying deep emotions and inspiration.";
    }

    // API yanıtındaki istenmeyen ifadeleri temizle (örneğin, 'Visual Description:')
    const basePrompt = freeformPrompt.generations[0].text
      .replace("Visual Description:", "")
      .trim();

    console.log(basePrompt);
    return basePrompt;
  } catch (error) {
    console.error("❌ Error in generateImagePrompt function:", error);
    return "A mesmerizing and thought-provoking visual landscape filled with ambition and resilience.";
  }
}

// 📌 **Canvas ile Caption'ı Görsele Ekleme (Metni Alt Satıra Geçirerek)**
async function addCaptionToImage(imagePath, caption) {
  try {
    const image = await loadImage(imagePath);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");

    ctx.drawImage(image, 0, 0, image.width, image.height);

    // 📌 Yazı stilini belirle
    const fontSize = Math.floor(image.width * 0.05);
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.fillStyle = "white";
    ctx.textAlign = "center";
    ctx.shadowColor = "black";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    // 📌 Metni satırlara ayır
    const maxWidth = image.width * 0.8; // Metnin sığabileceği maksimum genişlik (%80)
    const lineHeight = fontSize * 1.2; // Satır yüksekliği
    const lines = [];
    let currentLine = "";
    const words = caption.split(" ");

    words.forEach((word) => {
      const testLine = currentLine + (currentLine ? " " : "") + word;
      const testWidth = ctx.measureText(testLine).width;

      if (testWidth > maxWidth) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    });

    if (currentLine) {
      lines.push(currentLine);
    }

    // 📌 Metni resmin alt kısmına yerleştir
    const x = image.width / 2;
    let y = image.height - lineHeight * lines.length - fontSize * 0.5;

    lines.forEach((line) => {
      ctx.fillText(line, x, y);
      y += lineHeight;
    });

    // 📌 Yeni görseli .jpg formatında kaydet
    const editedImagePath = imagePath.replace(".png", ".jpg");
    const buffer = canvas.toBuffer("image/jpeg");
    fs.writeFileSync(editedImagePath, buffer);

    console.log(`✅ Caption eklenmiş görsel kaydedildi: ${editedImagePath}`);
    return editedImagePath;
  } catch (error) {
    console.error("❌ Görsele yazı eklenirken hata oluştu:", error);
    return null;
  }
}

// 📌 **Instagram Postu Oluşturma**
async function generateInstagramPost() {
  try {
    // 🎯 **Motivasyon Cümlesi Üret**
    const themes = [
      "Başarı ve Azim",
      "Özgüven ve Kendi Değerini Bilmek",
      "Hayaller ve Büyük Düşünmek",
      "Cesaret ve Korkusuzluk",
      "Mutluluk ve Yaşam Sevinci",
      "Zorlukları Aşmak",
      "Liderlik ve İlham Vermek",
    ];

    const chosenTheme = themes[Math.floor(Math.random() * themes.length)];

    const motivationResponse = await cohere.generate({
      model: "command-r-plus",
      prompt: `Generate a short, powerful, and inspiring motivational quote in Turkish related to "${chosenTheme}".  
      - The quote must not exceed 15 words.  
      - The language must strictly be in Turkish.  
      - Ensure the tone is uplifting, emotionally strong, and deeply inspiring.  
      - The quote should sound poetic, impactful, and profound.  
      - It should be unique, avoiding overused phrases.
      
      Example categories:
      - "Başarı ve Azim": "Düşersen kalkarsın, ama vazgeçersen her şey biter."
      - "Özgüven ve Kendi Değerini Bilmek": "Sen yıldızların ışığını taşıyan bir ruhsun, parlamaktan korkma!"
      - "Hayaller ve Büyük Düşünmek": "Sınırları zihin çizer, hayaller ise özgürlüğün anahtarıdır."
      - "Cesaret ve Korkusuzluk": "Karanlığa meydan okumadan, güneşi kucaklayamazsın."
      - "Mutluluk ve Yaşam Sevinci": "Bugün gülümse, çünkü hayat seni bekliyor!"
      - "Zorlukları Aşmak": "Fırtınalar güçlü ruhları şekillendirir, sükûnet ise zaferi anlatır."
      - "Liderlik ve İlham Vermek": "Önde yürüyen, arkasında cesaret filizleri bırakır."
  
      Now, generate a new unique and impactful quote for the "${chosenTheme}" category.`,

      max_tokens: 50,
      temperature: 0.7,
    });

    const motivationQuote = motivationResponse.generations[0].text.trim();

    // 🔥 **Hashtag Üretme**
    const hashtagsResponse = await cohere.generate({
      model: "command-r-plus",
      prompt: `Generate up to 5 relevant and motivational hashtags in Turkish based on the following quote.  
      - Hashtags should be short, effective, and widely used in motivational contexts.  
      - Avoid lengthy or complex hashtags.  
      - Language must strictly be Turkish.  

      Motivational Quote:  
      "${motivationQuote}"`,

      max_tokens: 50,
      temperature: 0.7,
    });

    const rawHashtags = hashtagsResponse.generations[0].text.trim();
    const formattedHashtags = rawHashtags.replace(/\n/g, " "); // Satırları birleştir

    // 🎨 **Gerçekçi Görsel Açıklaması Üret**
    const imagePrompt = await generateImagePrompt(motivationQuote);

    // 🖼️ **Görsel Üretme**
    const imageUrl = await generateImage(imagePrompt);
    const localImagePath = path.join(
      __dirname,
      "images",
      path.basename(imageUrl)
    );

    // 📌 Caption'ı Görsele Ekle
    const finalImagePath = await addCaptionToImage(
      localImagePath,
      motivationQuote
    );

    // 📌 **Sonuç**
    const imagePublicUrl = `${SERVER_URL}/images/${path.basename(
      finalImagePath
    )}`;
    const generatedPost = {
      quote: motivationQuote,
      image_url: imagePublicUrl,
      caption: `${motivationQuote} ${formattedHashtags}`,
    };

    return generatedPost;
  } catch (error) {
    console.error("❌ Cohere API Error:", error);
    return null;
  }
}

// 📌 **Görsel Üretme API Bağlantısı**

const generateImage = async (prompt) => {
  if (!prompt) {
    throw new Error("❌ Error: Prompt is required");
  }

  try {
    // 📌 **DOĞRU** Multipart FormData kullanımı
    const formData = new FormData();
    formData.append("prompt", prompt);
    formData.append("output_format", "jpeg"); // Desteklenen formatlar: jpeg, png, webp

    const response = await fetch(IMAGE_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${IMAGE_API_KEY}`,
        Accept: "application/json", // 🔥 StabilityAI API'sinin beklediği başlık!
        ...formData.getHeaders(), // 🔥 FormData için gerekli başlıklar
      },
      body: formData, // 🔥 FormData DOĞRU şekilde body olarak gönderiliyor
    });

    // Yanıtı JSON olarak alıyoruz
    const data = await response.json();
    console.log(data);

    if (!data.image) {
      throw new Error("❌ AI did not return an image!");
    }

    // 📌 Base64 formatındaki görseli çözüyoruz
    const imageBuffer = Buffer.from(data.image, "base64");

    // 📌 Görseli kaydetme yolu
    const imagesDir = path.join(__dirname, "images");
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }

    const imagePath = path.join(imagesDir, `generated_${Date.now()}.jpg`);
    fs.writeFileSync(imagePath, imageBuffer);

    console.log(`✅ Image saved successfully: ${imagePath}`);
    return `${SERVER_URL}/images/${path.basename(imagePath)}`;
  } catch (error) {
    console.error("❌ Error:", error.message);
    throw error;
  }
};

// 📌 **API Endpoint - Instagram Post Oluşturma**
app.post("/generate-instagram-post", async (req, res) => {
  if (!generatedPost) {
    return res
      .status(500)
      .json({ error: "Yapay zeka içeriği oluşturulamadı." });
  }

  res.json({
    message: "Başarıyla işlendi ve Instagram'a gönderildi.",
    generatedPost,
  });
});

async function createAndShareInstagramPost() {
  try {
    const generatedPost = await generateInstagramPost();
    if (!generatedPost) {
      console.error("❌ Instagram post could not be generated.");
      return;
    }
    await shareOnInstagram(generatedPost.image_url, generatedPost.caption);
  } catch (error) {
    console.error("❌ Instagram post could not be generated.");
  }
}

cron.schedule("0 9 * * *", async () => {
  console.log("🕘 Running scheduled Instagram post creation...");
  await createAndShareInstagramPost();
});

app.listen(PORT, () => {
  console.log(`✅ Server running at ${SERVER_URL}`);
});
