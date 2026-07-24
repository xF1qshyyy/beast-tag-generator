// ===============================
// BEAST Tag Generator
// Part 1
// ===============================

const canvas = document.getElementById("tagCanvas");
const ctx = canvas.getContext("2d");

ctx.imageSmoothingEnabled = false;

const baseImage = new Image();

baseImage.src = "beasttagbase.png";

baseImage.onload = () => {

    redraw();

};

function redraw(){

    ctx.clearRect(0,0,canvas.width,canvas.height);

    ctx.drawImage(

        baseImage,

        0,
        0,

        canvas.width,
        canvas.height

    );

}
