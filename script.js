const cameraView = document.getElementById('camera-view');
const recordBtn = document.getElementById('record-btn');
const altitudeText = document.getElementById('altitude-text');
const sliderWrapper = document.getElementById('slider-wrapper');
const cameraPage = document.getElementById('camera-page');
const switchCameraBtn = document.getElementById('switch-camera-btn');
const totalDownloadBtn = document.getElementById('total-download-btn'); 

let mediaRecorder;
let recordedChunks = [];
let currentSlideIndex = 0;
let totalSlides = 1;

let currentFacingMode = "user";
let db;

// 브라우저가 지원하는 최적의 비디오 포맷을 찾는 함수
function getSupportedMimeType() {
    const types = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4;codecs=avc1',
        'video/mp4'
    ];
    for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
}

// 브라우저 내부 비밀 저장소(IndexedDB) 열기
function initDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("HikeCameraDB", 1);

        request.onupgradeneeded = function(e) {
            const database = e.target.result;
            database.createObjectStore("videos", { keyPath: "id", autoIncrement: true });
        };

        request.onsuccess = function(e) {
            db = e.target.result;
            resolve();
        };

        request.onerror = function(e) {
            console.error("DB 에러", e);
            reject();
        };
    });
}

// 실시간 촬영 대기화면 전용 시계 구동 함수
function startCameraClock() {
    let cameraTimeText = document.getElementById('camera-time-text');
    if (!cameraTimeText) {
        cameraTimeText = document.createElement('div');
        cameraTimeText.id = 'camera-time-text';
        
        cameraTimeText.style.position = 'absolute';
        cameraTimeText.style.top = '14px';
        cameraTimeText.style.left = '14px';
        cameraTimeText.style.color = 'white';
        cameraTimeText.style.fontSize = '15px';
        cameraTimeText.style.fontWeight = '600';
        cameraTimeText.style.fontFamily = 'system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
        cameraTimeText.style.letterSpacing = '-0.3px';
        cameraTimeText.style.zIndex = '10';
        if (cameraPage) {
            cameraPage.style.position = 'relative'; 
            cameraPage.appendChild(cameraTimeText);
        }
    }

    function updateClock() {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        cameraTimeText.innerText = `${hours}:${minutes}`;
    }
    updateClock();
    setInterval(updateClock, 1000); 
}

// 카메라 켜기
async function startCamera() {
    if (cameraView.srcObject) {
        cameraView.srcObject.getTracks().forEach(track => track.stop());
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacingMode },
            audio: true
        });

        cameraView.srcObject = stream;
        
        if (currentFacingMode === "user") {
            cameraView.style.transform = "scaleX(-1)";
        } else {
            cameraView.style.transform = "scaleX(1)";
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        cameraView.onloadedmetadata = () => {
            canvas.width = cameraView.videoWidth;
            canvas.height = cameraView.videoHeight;
        };

        function drawFrame() {
            if (cameraView.paused || cameraView.ended || !canvas.width) {
                requestAnimationFrame(drawFrame);
                return;
            }
            
            const vw = cameraView.videoWidth;
            const vh = cameraView.videoHeight;
            if (canvas.width !== vw || canvas.height !== vh) {
                canvas.width = vw;
                canvas.height = vh;
            }

            ctx.save();
            if (currentFacingMode === "user") {
                ctx.scale(-1, 1);
                ctx.drawImage(cameraView, -vw, 0, vw, vh);
            } else {
                ctx.drawImage(cameraView, 0, 0, vw, vh);
            }
            ctx.restore();
            requestAnimationFrame(drawFrame);
        }
        
        cameraView.onplay = drawFrame;

        const canvasStream = canvas.captureStream(30);
        canvasStream.addTrack(stream.getAudioTracks()[0]);

        const mimeType = getSupportedMimeType();
        const options = mimeType ? { mimeType } : {};
        mediaRecorder = new MediaRecorder(canvasStream, options);

        mediaRecorder.ondataavailable = function(event) {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };
        
        mediaRecorder.onstop = async function() {
            const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'video/mp4' });
            recordedChunks = [];
            const currentAltitude = altitudeText.innerText;
            const now = new Date();
            const recordTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            const savedId = await saveVideoToDB(blob, currentAltitude, recordTime);
            addVideoSlideToUI(blob, currentAltitude, savedId, recordTime);
        };

    } catch (error) {
        console.error("카메라 에러:", error);
        alert("카메라 혹은 마이크 권한을 허용해주세요!");
    }
}

function saveVideoToDB(blob, altitude, recordTime) {
    return new Promise((resolve) => {
        const transaction = db.transaction(["videos"], "readwrite");
        const store = transaction.objectStore("videos");
        const request = store.add({ videoBlob: blob, altitudeText: altitude, recordTime: recordTime });
        request.onsuccess = (e) => resolve(e.target.result);
    });
}

function deleteVideoFromDB(id) {
    return new Promise((resolve) => {
        const transaction = db.transaction(["videos"], "readwrite");
        const store = transaction.objectStore("videos");
        const request = store.delete(id);
        request.onsuccess = () => resolve();
    });
}

function loadSavedVideos() {
    const transaction = db.transaction(["videos"], "readonly");
    const store = transaction.objectStore("videos");
    const request = store.getAll();

    request.onsuccess = function(e) {
        const savedList = e.target.result;
        savedList.forEach(item => {
            addVideoSlideToUI(item.videoBlob, item.altitudeText, item.id, item.recordTime);
        });
    };
}

function addVideoSlideToUI(blob, altitude, id, recordTime) {
    const videoURL = URL.createObjectURL(blob);

    const newSlide = document.createElement('div');
    newSlide.className = 'slide-page';
    newSlide.style.position = 'relative'; 

    const newVideo = document.createElement('video');
    newVideo.src = videoURL;
    newVideo.className = 'saved-video';

    newVideo.muted = true;
    newVideo.playsInline = true;
    newVideo.setAttribute('playsinline', '');
    newVideo.controls = true;
    newVideo.loop = true;

    const newOverlay = document.createElement('div');
    newOverlay.className = 'altitude-overlay';
    newOverlay.innerHTML = `<span>${altitude}</span>`;

    const timeOverlay = document.createElement('div');
    timeOverlay.className = 'time-overlay';
    
    timeOverlay.style.position = 'absolute';
    timeOverlay.style.top = '14px';
    timeOverlay.style.left = '14px';
    timeOverlay.style.color = 'white';
    timeOverlay.style.fontSize = '15px';
    timeOverlay.style.fontWeight = '600';
    timeOverlay.style.fontFamily = 'system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    timeOverlay.style.letterSpacing = '-0.3px';
    timeOverlay.style.zIndex = '10';

    const displayTime = recordTime || `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;
    timeOverlay.innerHTML = `<span>${displayTime}</span>`;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.setAttribute('aria-label', '영상 삭제');
    deleteBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        <line x1="10" y1="11" x2="10" y2="17"></line>
        <line x1="14" y1="11" x2="14" y2="17"></line>
        </svg>
    `;

    deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();

        if (confirm("이 영상을 영구 삭제하시겠습니까?")) {
            await deleteVideoFromDB(id);

            const childrenArray = Array.from(sliderWrapper.children);
            const slideIndex = childrenArray.indexOf(newSlide);

            newSlide.remove();
            totalSlides--;

            if (slideIndex <= currentSlideIndex) {
                if (currentSlideIndex >= totalSlides) {
                    currentSlideIndex = totalSlides - 1;
                } else if (slideIndex < currentSlideIndex) {
                    currentSlideIndex--;
                }
            }

            updateSliderPosition();
        }
    });

    newSlide.appendChild(newVideo);
    newSlide.appendChild(newOverlay);
    newSlide.appendChild(timeOverlay); 
    newSlide.appendChild(deleteBtn);

    sliderWrapper.style.transition = 'none';
    sliderWrapper.insertBefore(newSlide, cameraPage);

    totalSlides++;
    currentSlideIndex++;
    updateSliderPosition();

    sliderWrapper.offsetHeight;
    sliderWrapper.style.transition = 'transform 0.3s ease-out';
}

function updateSliderPosition() {
    sliderWrapper.style.transform = `translateX(-${currentSlideIndex * 100}%)`;

    const slides = sliderWrapper.children;
    for (let i = 0; i < slides.length; i++) {
        const video = slides[i].querySelector('.saved-video');
        if (video) {
            if (i === currentSlideIndex) {
                video.load();
                video.play().catch(err => console.log("자동재생 정책 우회 중: ", err));
            } else {
                video.pause();
            }
        }
    }
}

function getRealAltitude() {
    navigator.geolocation.getCurrentPosition(async function(position) {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        try {
            const response = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lng}`);
            const data = await response.json();
            const elevation = Math.round(data.elevation[0]);
            altitudeText.innerText = "⛰️ 해발 " + elevation + "m";
        } catch (error) {
            altitudeText.innerText = "⛰️ 고도 로딩 실패";
        }
    }, function(error) {
        altitudeText.innerText = "⛰️ GPS 연결 실패";
    });
}

recordBtn.addEventListener('click', () => {
    if (!mediaRecorder || mediaRecorder.state === 'recording') return;

    mediaRecorder.start();
    recordBtn.innerText = "녹화중";
    recordBtn.style.backgroundColor = "gray";
    recordBtn.style.borderColor = "gray";

    getRealAltitude();

    setTimeout(() => {
        mediaRecorder.stop();
        recordBtn.innerText = "REC";
        recordBtn.style.backgroundColor = "red";
        recordBtn.style.borderColor = "white";
    }, 3000); 
});

switchCameraBtn.addEventListener('click', () => {
    currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
    startCamera();
});

let touchStartX = 0;
let touchEndX = 0;

document.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; });
document.addEventListener('touchend', e => { touchEndX = e.changedTouches[0].screenX; handleSwipe(); });
document.addEventListener('mousedown', e => { touchStartX = e.screenX; });
document.addEventListener('mouseup', e => { touchEndX = e.screenX; handleSwipe(); });

function handleSwipe() {
    const swipeDistance = touchStartX - touchEndX;

    if (swipeDistance < -50) {
        if (currentSlideIndex > 0) {
            currentSlideIndex--;
            updateSliderPosition();
        }
    }
    if (swipeDistance > 50) {
        if (currentSlideIndex < totalSlides - 1) {
            currentSlideIndex++;
            updateSliderPosition();
        }
    }
}

// 애플 기기 친화형 다운로드 코덱 탐색 보조 함수 (독립 선언)
function getDownloadMimeType() {
    const appleFriendlyTypes = [
        'video/mp4;codecs=avc1',   
        'video/mp4;codecs=h264',
        'video/mp4',
        'video/quicktime'          
    ];
    for (const type of appleFriendlyTypes) {
        if (MediaRecorder.isTypeSupported(type)) return type;
    }
    if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) return 'video/webm;codecs=vp9';
    return 'video/webm';
}

// ==========================================
// 비디오 캔버스 병합 인코더 시스템
// ==========================================
totalDownloadBtn.addEventListener('click', generateTotalLogVideo);

async function generateTotalLogVideo() {
    const transaction = db.transaction(["videos"], "readonly");
    const store = transaction.objectStore("videos");
    const request = store.getAll();

    request.onsuccess = async function(e) {
        const savedList = e.target.result.sort((a, b) => a.id - b.id);
        if (savedList.length === 0) {
            alert("아직 촬영된 영상이 없습니다! 먼저 영상을 녹화해 주세요.");
            return;
        }

        totalDownloadBtn.disabled = true;
        totalDownloadBtn.innerText = "⏳ 등산 log 제작 중...";

        const canvas = document.createElement('canvas');
        canvas.width = 720;
        canvas.height = 1280;
        const ctx = canvas.getContext('2d');

        const bgImg = new Image();
        bgImg.src = 'my-background.png';
        await new Promise((resolve) => { bgImg.onload = resolve; });

        const hiddenVideo = document.createElement('video');
        hiddenVideo.playsInline = true;
        hiddenVideo.setAttribute('playsinline', ''); 
        
        hiddenVideo.style.position = 'fixed';
        hiddenVideo.style.top = '0';
        hiddenVideo.style.left = '-9999px'; 
        hiddenVideo.style.width = '1px';
        hiddenVideo.style.height = '1px';
        hiddenVideo.style.opacity = '0.01';
        hiddenVideo.style.pointerEvents = 'none';
        document.body.appendChild(hiddenVideo);

        // 💡 오디오 믹싱 컨텍스트 설정 시작 (사파리 무음 인코딩 격파)
        let audioContext = null;
        let audioDestination = null;
        let audioSource = null;

        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            audioContext = new AudioContextClass();
            audioDestination = audioContext.createMediaStreamDestination();
            
            // 사파리가 소리 트랙을 만들도록 muted를 해제하고, 하드웨어 스피커 볼륨만 0으로 음소거
            hiddenVideo.muted = false;
            hiddenVideo.volume = 0;

            audioSource = audioContext.createMediaElementSource(hiddenVideo);
            audioSource.connect(audioDestination);
        } catch (err) {
            console.warn("오디오 설정 실패:", err);
        }

        // 1. 캔버스 화면 스트림 생성
        const canvasStream = canvas.captureStream(30);
        
        // 2. 비디오 트랙과 오디오 컨텍스트 트랙 결합
        const combinedStream = new MediaStream();
        canvasStream.getVideoTracks().forEach(track => combinedStream.addTrack(track));

        if (audioDestination && audioDestination.stream.getAudioTracks().length > 0) {
            const audioTrack = audioDestination.stream.getAudioTracks()[0];
            combinedStream.addTrack(audioTrack);
        }

        // 3. 인코딩 데이터 청크 및 미디어 레코더 초기화
        const encodedChunks = [];
        const downloadMimeType = getDownloadMimeType();
        const canvasRecorder = new MediaRecorder(combinedStream, downloadMimeType ? { mimeType: downloadMimeType } : {});

        canvasRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) encodedChunks.push(event.data);
        };

        canvasRecorder.onstop = () => {
            const actualMime = canvasRecorder.mimeType || '';
            let extension = 'mp4';
            
            if (actualMime.includes('webm')) {
                extension = 'webm';
            } else if (actualMime.includes('quicktime')) {
                extension = 'mov';
            }

            const finalBlob = new Blob(encodedChunks, { type: actualMime || 'video/mp4' });
            const finalVideoURL = URL.createObjectURL(finalBlob);

            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0'); 
            const day = String(now.getDate()).padStart(2, '0');
            const formattedDate = `${year}.${month}.${day}`;

            const downloadAnchor = document.createElement('a');
            downloadAnchor.href = finalVideoURL;
            downloadAnchor.download = `${formattedDate} 등산log.${extension}`;
            downloadAnchor.click();

            if (extension === 'webm') {
                alert("⚠️ 현재 브라우저가 MP4 녹화를 지원하지 않아 WebM으로 다운로드되었습니다. 맥북 QuickTime 대신 Chrome 브라우저나 VLC 플레이어를 이용해 주세요.");
            }

            totalDownloadBtn.disabled = false;
            totalDownloadBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v4M7 10l5 5 5-5M12 15V3"/>
                </svg><span>등산log 다운로드</span>`;
        };

        canvasRecorder.start();

        for (const item of savedList) {
            hiddenVideo.src = URL.createObjectURL(item.videoBlob);

            await new Promise((resolve) => {
                hiddenVideo.onloadeddata = resolve; 
            });
            await hiddenVideo.play();

            let isCurrentVideoPlaying = true;
            hiddenVideo.onended = () => { isCurrentVideoPlaying = false; };

            while (isCurrentVideoPlaying) {
                ctx.drawImage(bgImg, 0, 0, canvas.width, canvas.height);

                const containerWidth = canvas.width * 0.85; 
                const containerHeight = containerWidth * (9 / 16); 
                const videoX = (canvas.width - containerWidth) / 2;
                const videoY = (canvas.height - containerHeight) / 2;

                const drawWidth = containerWidth;
                const drawHeight = containerWidth * (hiddenVideo.videoHeight / hiddenVideo.videoWidth);
                
                const offsetX = videoX;
                const offsetY = videoY - (drawHeight - containerHeight) / 2;

                ctx.save();
                ctx.beginPath();
                ctx.roundRect(videoX, videoY, containerWidth, containerHeight, 20);
                ctx.clip(); 
                
                ctx.drawImage(hiddenVideo, offsetX, offsetY, drawWidth, drawHeight);
                ctx.restore();

                // 🌟 자막 렌더링 시스템 (28px 최종 튜닝 노-그림자 버전)
                ctx.shadowColor = "transparent";
                ctx.shadowBlur = 0;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;
                ctx.fillStyle = "white"; 

                // 6. 시간 자막 (23px로 28px 자막과 황금 조화)
                ctx.font = "600 23px -apple-system, Apple SD Gothic Neo, Malgun Gothic, sans-serif";
                ctx.textAlign = "left";
                ctx.textBaseline = "top";
                
                const timeX = videoX + 19; 
                const timeY = videoY + 19; 
                
                const displayTime = item.recordTime || "00:00";
                ctx.fillText(displayTime, timeX, timeY);

                // 7. 고도 자막 (완벽 가독성의 28px 크기)
                ctx.font = "bold 28px -apple-system, Apple SD Gothic Neo, Malgun Gothic, sans-serif"; 
                ctx.textBaseline = "middle";
                ctx.textAlign = "left"; 

                const fullAltitudeText = item.altitudeText || "⛰️ 해발 0m";
                const emojiStr = "⛰️";
                const cleanText = fullAltitudeText.replace("⛰️", "").trim(); 

                const fixedEmojiWidth = 33; 
                const gap = 9;  
                const textWidth = ctx.measureText(cleanText).width;
                
                const totalContentWidth = fixedEmojiWidth + gap + textWidth;
                const startX = (canvas.width - totalContentWidth) / 2;
                const centerY = videoY + (containerHeight / 2);

                ctx.fillText(emojiStr, startX, centerY);
                ctx.fillText(cleanText, startX + fixedEmojiWidth + gap, centerY);

                await new Promise(requestAnimationFrame);
            }
        }

        canvasRecorder.stop();
        hiddenVideo.remove(); 
    };
}

// 앱 시작 초기화
async function initApp() {
    await initDatabase();
    loadSavedVideos();
    await startCamera();
    startCameraClock(); 

    altitudeText.innerText = "⛰️ 초기 고도 측정 중...";
    getRealAltitude();
}

initApp();
