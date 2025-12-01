from flask import Flask, request, render_template, redirect, url_for, abort, jsonify
from tensorflow.keras.models import load_model
from tensorflow.keras.preprocessing import image
import numpy as np
import os
import zipfile
from PIL import Image
import uuid
from werkzeug.utils import secure_filename

app = Flask(__name__)


# ----------------------------------------------------------
#                   FOLDERS (now under static so files are public)
# ----------------------------------------------------------
UPLOAD_BASE = os.path.join("static", "uploads")
UPLOAD_FOLDER = UPLOAD_BASE  # kept for compatibility
SKIN_FOLDER = os.path.join(UPLOAD_BASE, "skin")
XRAY_FOLDER = os.path.join(UPLOAD_BASE, "xray")
SKIN_EXTRACT_FOLDER = os.path.join(UPLOAD_BASE, "skin_extracted")
XRAY_EXTRACT_FOLDER = os.path.join(UPLOAD_BASE, "xray_extracted")

for folder in [UPLOAD_BASE, SKIN_FOLDER, XRAY_FOLDER, SKIN_EXTRACT_FOLDER, XRAY_EXTRACT_FOLDER]:
    os.makedirs(folder, exist_ok=True)

# ----------------------------------------------------------
#                   LOAD MODELS (FIXED PATHS)
# ----------------------------------------------------------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))     # UI/
MODEL_DIR = os.path.join(BASE_DIR, "Trained Model files")  # UI/Trained Model files/

try:
    skin_model = load_model(os.path.join(MODEL_DIR, "skin_cancer_scratch_model.keras"))
    SKIN_AVAILABLE = True
except Exception as e:
    print("Skin model not loaded:", e)
    SKIN_AVAILABLE = False

try:
    xray_model = load_model(os.path.join(MODEL_DIR, "xray_classifier_model.keras"))
    XRAY_AVAILABLE = True
except Exception as e:
    print("X-ray model not loaded:", e)
    XRAY_AVAILABLE = False


# ----------------------------------------------------------
#                   LABEL CLASSES
# ----------------------------------------------------------
SKIN_CLASSES = ["Benign", "Malignant"]

XRAY_CLASSES = [
    "Decreased Density", "Encapsulated Lesions", "Increased Density",
    "Infectious Degenerative", "Mediastinal Alterations",
    "Normal Anatomy", "Obstructive Disease",
    "Pulmonary Inflammatory Process (Pneumonia)", "Thoracic Alterations"
]

# ----------------------------------------------------------
#                   PREDICTION FUNCTIONS
# ----------------------------------------------------------
def predict_skin(img_path):
    if not SKIN_AVAILABLE:
        return "Model not loaded", 0, 0, False

    img = Image.open(img_path).convert("RGB").resize((224, 224))
    img_array = np.expand_dims(np.array(img) / 255.0, axis=0)

    raw = float(skin_model.predict(img_array)[0][0])
    label = "Benign" if raw < 0.5 else "Malignant"
    confidence = 1 - raw if raw < 0.5 else raw
    low_confidence = abs(raw - 0.5) < 0.1

    return label, confidence, raw, low_confidence


# ✅ UPDATED WITH TOP-3 LOGIC
def predict_xray(img_path):
    if not XRAY_AVAILABLE:
        return "Model not loaded", 0, [], []

    img = image.load_img(img_path, target_size=(224, 224))
    img_array = np.expand_dims(image.img_to_array(img) / 255.0, axis=0)
    pred = xray_model.predict(img_array)[0]

    # top-1 prediction
    best_idx = np.argmax(pred)
    best_label = XRAY_CLASSES[best_idx]
    best_conf = float(pred[best_idx] * 100)

    # top-3 predictions
    top3_idx = pred.argsort()[-3:][::-1]
    top3 = []
    for i in top3_idx:
        top3.append({
            "class": XRAY_CLASSES[i],
            "confidence": float(pred[i] * 100)
        })

    return best_label, best_conf, pred.tolist(), top3


# ----------------------------------------------------------
#                   FRONTEND PAGE ROUTES
# ----------------------------------------------------------
@app.route("/")
def home():
    return render_template("home.html")

@app.route("/home.html")
def home_html():
    return render_template("home.html")

@app.route("/about.html")
def about_html():
    return render_template("about.html")

@app.route("/finddoctors.html")
def finddoctors_html():
    return render_template("finddoctors.html")

@app.route("/contact.html")
def contact_html():
    return render_template("contact.html")

@app.route("/login.html")
def login_html():
    return render_template("login.html")

@app.route("/register.html")
def register_html():
    return render_template("register.html")

@app.route("/prediction.html")
def prediction_html():
    return render_template("prediction.html")

@app.route("/doctor-profile.html")
def doctor_profile_html():
    return render_template("doctor-profile.html")

# Main health records route (underscore)
@app.route("/profile/health_records")
def health_records_html():
    return render_template("health_records.html")

# Accept hyphen version too
@app.route("/profile/health-records")
def health_records_hyphen():
    return redirect(url_for("health_records_html"))

# ----------------------------------------------------------
#                   SKIN ROUTES
# ----------------------------------------------------------
@app.route("/skin_prediction")
def skin_prediction():
    return render_template("skin_prediction.html", auto_scroll=False)

@app.route("/skin_result", methods=["POST"])
def skin_result_page():
    skin_result = None
    skin_zip_results = []
    auto_scroll = False

    # ----- Single Image -----
    skin_file = request.files.get("skin_image")
    if skin_file and skin_file.filename != "":
        filename = secure_filename(skin_file.filename)
        unique_name = f"{uuid.uuid4().hex}_{filename}"
        path = os.path.join(SKIN_FOLDER, unique_name)
        skin_file.save(path)

        res = predict_skin(path)

        label, confidence, raw, low_confidence = res

        image_url = url_for('static', filename=f"uploads/skin/{unique_name}", _external=True)

        skin_result = {
            "label": label,
            "confidence": float(confidence),
            "raw": float(raw),
            "low_confidence": bool(low_confidence),
            "filename": filename,
            "image_url": image_url
        }
        auto_scroll = True

    # ----- ZIP Upload -----
    skin_zip = request.files.get("skin_zip")
    if skin_zip and skin_zip.filename != "":
        unique_folder = os.path.join(SKIN_EXTRACT_FOLDER, uuid.uuid4().hex)
        os.makedirs(unique_folder, exist_ok=True)

        zip_filename = secure_filename(skin_zip.filename)
        zip_path = os.path.join(SKIN_FOLDER, f"{uuid.uuid4().hex}_{zip_filename}")
        skin_zip.save(zip_path)

        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            zip_ref.extractall(unique_folder)

        for root, dirs, files in os.walk(unique_folder):
            for file in sorted(files):
                img_path = os.path.join(root, file)
                res = predict_skin(img_path)
                label, conf, raw, low = res

                safe_name = f"{uuid.uuid4().hex}_{secure_filename(file)}"
                dest_path = os.path.join(SKIN_FOLDER, safe_name)

                try:
                    os.replace(img_path, dest_path)
                    image_url = url_for('static', filename=f"uploads/skin/{safe_name}", _external=True)
                except Exception:
                    image_url = None

                skin_zip_results.append({
                    "filename": file,
                    "label": label,
                    "confidence": float(conf),
                    "raw": float(raw),
                    "image_url": image_url
                })

        auto_scroll = True

    return render_template(
        "skin_result.html",
        skin_result=skin_result,
        skin_zip_results=skin_zip_results,
        auto_scroll=auto_scroll
    )

# ----------------------------------------------------------
#                   XRAY ROUTES (Updated with Top-3)
# ----------------------------------------------------------
@app.route("/xray_prediction")
def xray_prediction_page():
    return render_template("xray_prediction.html", auto_scroll=False)

@app.route("/xray_result", methods=["POST"])
def xray_result_page():
    xray_result = None
    xray_zip_results = []
    auto_scroll = False

    # ----- Single -----
    xray_file = request.files.get("xray_image")
    if xray_file and xray_file.filename != "":
        filename = secure_filename(xray_file.filename)
        unique_name = f"{uuid.uuid4().hex}_{filename}"
        path = os.path.join(XRAY_FOLDER, unique_name)
        xray_file.save(path)

        label, conf_percent, raw_list, top3 = predict_xray(path)

        image_url = url_for('static', filename=f"uploads/xray/{unique_name}", _external=True)

        xray_result = {
            "label": label,
            "confidence_percent": float(conf_percent),
            "confidence": float(conf_percent) / 100.0,
            "top3": top3,
            "filename": filename,
            "image_url": image_url
        }
        auto_scroll = True

    # ----- ZIP Upload -----
    xray_zip = request.files.get("xray_zip")
    if xray_zip and xray_zip.filename != "":
        unique_folder = os.path.join(XRAY_EXTRACT_FOLDER, uuid.uuid4().hex)
        os.makedirs(unique_folder, exist_ok=True)

        zip_filename = secure_filename(xray_zip.filename)
        zip_path = os.path.join(XRAY_FOLDER, f"{uuid.uuid4().hex}_{zip_filename}")
        xray_zip.save(zip_path)

        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            zip_ref.extractall(unique_folder)

        for root, dirs, files in os.walk(unique_folder):
            for file in sorted(files):
                img_path = os.path.join(root, file)

                label, conf_percent, raw_list, top3 = predict_xray(img_path)

                safe_name = f"{uuid.uuid4().hex}_{secure_filename(file)}"
                dest_path = os.path.join(XRAY_FOLDER, safe_name)
                try:
                    os.replace(img_path, dest_path)
                    image_url = url_for('static', filename=f"uploads/xray/{safe_name}", _external=True)
                except Exception:
                    image_url = None

                xray_zip_results.append({
                    "filename": file,
                    "label": label,
                    "confidence_percent": float(conf_percent),
                    "confidence": float(conf_percent) / 100.0,
                    "top3": top3,
                    "image_url": image_url
                })

        auto_scroll = True

    return render_template(
        "xray_result.html",
        xray_result=xray_result,
        xray_zip_results=xray_zip_results,
        auto_scroll=auto_scroll
    )

# ----------------------------------------------------------
#                  RUN APP
# ----------------------------------------------------------
if __name__ == "__main__":
    app.run(debug=True)
