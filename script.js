/*
==========================================
BEAST Tag Generator
Part 1/20
Foundation
==========================================
*/

"use strict";

/* ---------- Canvas ---------- */

const canvas = document.getElementById("tagCanvas");
const ctx = canvas.getContext("2d");

ctx.imageSmoothingEnabled = false;

/* ---------- Image ---------- */

const baseImage = new Image();

baseImage.src = "beasttagbase.png";

/* ---------- Base Template Colors ---------- */

const BASE = {

    background:"#008fff",

    text:"#ffffff",

    shadow:"#636363"

};

/* ---------- UI ---------- */

const leftPicker =
document.getElementById("leftPicker");

const rightPicker =
document.getElementById("rightPicker");

const leftHex =
document.getElementById("leftHex");

const rightHex =
document.getElementById("rightHex");

const swapBtn =
document.getElementById("swapBtn");

const randomBtn =
document.getElementById("randomBtn");

const downloadBtn =
document.getElementById("downloadBtn");

/* ---------- Current Colors ---------- */

let leftColor="#CC0327";
let rightColor="#630AF3";

/* ---------- Helpers ---------- */

function clamp(v,min,max){

    return Math.min(
        Math.max(v,min),
        max
    );

}

function lerp(a,b,t){

    return a+(b-a)*t;

}

function hexToRgb(hex){

    hex=hex.replace("#","");

    return{

        r:parseInt(hex.substring(0,2),16),

        g:parseInt(hex.substring(2,4),16),

        b:parseInt(hex.substring(4,6),16)

    };

}

function rgbToHex(r,g,b){

    return "#"+

    [r,g,b]

    .map(v=>{

        return clamp(

            Math.round(v),

            0,

            255

        )

        .toString(16)

        .padStart(2,"0");

    })

    .join("");

}

function mix(c1,c2,t){

    return{

        r:lerp(c1.r,c2.r,t),

        g:lerp(c1.g,c2.g,t),

        b:lerp(c1.b,c2.b,t)

    };

}

/* ---------- Image Ready ---------- */

baseImage.onload=()=>{

    redraw();

};

/* ---------- Placeholder ---------- */

function redraw(){

    ctx.clearRect(

        0,

        0,

        canvas.width,

        canvas.height

    );

    ctx.drawImage(

        baseImage,

        0,

        0,

        canvas.width,

        canvas.height

    );

}
/*
==========================================
BEAST Tag Generator
Part 2/20
UI Controls
==========================================
*/

/* ---------- Validation ---------- */

function normalizeHex(hex){

    hex = hex.trim();

    if(!hex.startsWith("#")){

        hex = "#" + hex;

    }

    hex = hex.toUpperCase();

    if(/^#[0-9A-F]{6}$/.test(hex)){

        return hex;

    }

    return null;

}

/* ---------- Sync UI ---------- */

function updateUI(){

    leftPicker.value = leftColor;

    rightPicker.value = rightColor;

    leftHex.value = leftColor.toUpperCase();

    rightHex.value = rightColor.toUpperCase();

}

/* ---------- Picker Events ---------- */

leftPicker.addEventListener("input",()=>{

    leftColor = leftPicker.value.toUpperCase();

    updateUI();

    redraw();

});

rightPicker.addEventListener("input",()=>{

    rightColor = rightPicker.value.toUpperCase();

    updateUI();

    redraw();

});

/* ---------- Hex Events ---------- */

leftHex.addEventListener("change",()=>{

    const value = normalizeHex(leftHex.value);

    if(value){

        leftColor = value;

        updateUI();

        redraw();

    }

    else{

        updateUI();

    }

});

rightHex.addEventListener("change",()=>{

    const value = normalizeHex(rightHex.value);

    if(value){

        rightColor = value;

        updateUI();

        redraw();

    }

    else{

        updateUI();

    }

});

/* ---------- Swap ---------- */

swapBtn.addEventListener("click",()=>{

    const temp = leftColor;

    leftColor = rightColor;

    rightColor = temp;

    updateUI();

    redraw();

});

/* ---------- Random ---------- */

function randomHex(){

    const n = Math.floor(

        Math.random()*16777215

    );

    return "#" +

    n

    .toString(16)

    .padStart(6,"0")

    .toUpperCase();

}

randomBtn.addEventListener("click",()=>{

    leftColor = randomHex();

    rightColor = randomHex();

    updateUI();

    redraw();

});

/* ---------- PNG Button Placeholder ---------- */

downloadBtn.addEventListener("click",()=>{

    alert("PNG export coming in Part 18.");

});

/* ---------- Initialize ---------- */

updateUI();
