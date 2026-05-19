import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { getGame, saveScore, saveQuizRecord } from "../../lib/db";
import confetti from "canvas-confetti";

export default function ARScanner() {
  const { gameCode } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // AR & Quiz State
  const [markerFound, setMarkerFound] = useState(false);
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [showQuiz, setShowQuiz] = useState(false);
  
  // Progress State
  const [attempts, setAttempts] = useState(0);
  const [isCorrect, setIsCorrect] = useState(false);
  const [lastEarnedScore, setLastEarnedScore] = useState(0);
  const [totalEarnedScore, setTotalEarnedScore] = useState(0);
  const [answeredMarkerIds, setAnsweredMarkerIds] = useState([]);
  const [wrongAnswers, setWrongAnswers] = useState([]);

  const teamName = location.state?.teamName || "Anonymous Team";

  useEffect(() => {
    // Ensure html, body, and root are completely transparent
    // iOS Safari often has a default white background on the html element
    document.documentElement.style.backgroundColor = "transparent";
    document.body.style.backgroundColor = "transparent";
    // Remove overflow hidden which can cause iOS Safari to clip the AR video
    const originalOverflow = document.body.style.overflowX;
    document.body.style.overflowX = "visible";
    
    const rootEl = document.getElementById("root");
    if (rootEl) rootEl.style.backgroundColor = "transparent";
    
    // Force AR.js to recalculate video dimensions to fit the device screen perfectly
    const resizeTimeout = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 500);
    
    return () => {
      clearTimeout(resizeTimeout);
      document.documentElement.style.backgroundColor = "";
      document.body.style.backgroundColor = "#f8fafc";
      document.body.style.overflowX = originalOverflow || "hidden"; // Restore original or default
      if (rootEl) rootEl.style.backgroundColor = "";
    };
  }, []);

  useEffect(() => {
    const fetchGame = async () => {
      const g = await getGame(gameCode);
      if (g) {
        // Fallback for older single-question games
        if (!g.questions && g.question) {
          g.questions = [{
             markerId: 1, 
             question: g.question, 
             points: g.points || 100, 
             options: g.options, 
             correctOption: g.correctOption 
          }];
        }
        setGame(g);
      } else {
        alert("Invalid Game Code");
        navigate("/student");
      }
      setLoading(false);
    };
    fetchGame();
  }, [gameCode, navigate]);

  useEffect(() => {
    if (!game || !game.questions) return;
    
    const markers = document.querySelectorAll("a-marker");
    
    const handleMarkerFound = (e) => {
      const markerIdStr = e.target.id.replace('marker-', '');
      const mId = parseInt(markerIdStr);
      
      const q = game.questions.find(x => x.markerId === mId);
      // Only trigger if we haven't already answered this marker correctly
      if (q) {
        setMarkerFound(true);
        if (!answeredMarkerIds.includes(q.markerId)) {
          setActiveQuestion(q);
          setTimeout(() => setShowQuiz(true), 1500);
        }
      }
    };

    const handleMarkerLost = () => {
      setMarkerFound(false);
    };

    markers.forEach(m => {
      m.addEventListener("markerFound", handleMarkerFound);
      m.addEventListener("markerLost", handleMarkerLost);
    });

    return () => {
      markers.forEach(m => {
        m.removeEventListener("markerFound", handleMarkerFound);
        m.removeEventListener("markerLost", handleMarkerLost);
      });
    };
  }, [game, answeredMarkerIds]); // Bind after A-Frame elements render and progress updates

  const handleAnswer = async (selectedOption) => {
    if (!activeQuestion) return;
    
    const isAnswerCorrect = selectedOption === activeQuestion.correctOption;
    const selectedAnswerText = activeQuestion.options[selectedOption];
    
    // Save record to Firebase immediately
    try {
      await saveQuizRecord(
        gameCode, 
        teamName, 
        activeQuestion.question, 
        isAnswerCorrect,
        selectedAnswerText
      );
    } catch (err) {
      console.error("Failed to save quiz record", err);
    }

    const newAttempts = attempts + 1;
    setAttempts(newAttempts);

    if (isAnswerCorrect) {
      setIsCorrect(true);
      const finalScore = Math.round(activeQuestion.points * Math.pow(0.75, newAttempts - 1));
      
      const newTotal = totalEarnedScore + finalScore;
      setLastEarnedScore(finalScore);
      setTotalEarnedScore(newTotal);
      setAnsweredMarkerIds(prev => [...prev, activeQuestion.markerId]);
      
      confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });

      // Save cumulative score to Firebase
      await saveScore(gameCode, teamName, newTotal);
      
    } else {
      setWrongAnswers(prev => [...prev, selectedOption]);
    }
  };

  const handleContinue = () => {
    setShowQuiz(false);
    setIsCorrect(false);
    setAttempts(0);
    setWrongAnswers([]);
    setActiveQuestion(null);
  };

  if (loading) return <div className="flex h-screen items-center justify-center">Loading Camera...</div>;

  const isGameComplete = game?.questions && answeredMarkerIds.length === game.questions.length;

  return (
    <>
      <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", zIndex: 0 }}>
        <a-scene embedded arjs="sourceType: webcam; debugUIEnabled: false;">
          {game?.questions?.map((q) => (
            <a-marker 
              key={q.markerId}
              type="pattern" 
              url={`${import.meta.env.BASE_URL}markers/marker${q.markerId}.patt`}
              id={`marker-${q.markerId}`}
            >
              <a-entity
                gltf-model={`url(${import.meta.env.BASE_URL}models/model-${q.markerId}.glb)`}
                scale="0.5 0.5 0.5"
                position="0 0 0"
                rotation="-90 0 0"
                animation-mixer="loop: repeat"
              ></a-entity>
            </a-marker>
          ))}
          <a-entity camera></a-entity>
        </a-scene>
      </div>

      <div className="absolute top-4 left-4 z-10 bg-white/80 p-3 rounded-xl backdrop-blur-sm shadow-md">
        <h2 className="font-bold text-slate-800">Team: {teamName}</h2>
        <p className="text-sm text-slate-600 font-mono">Game: {gameCode}</p>
        <p className="text-sm font-bold text-primary-600 mt-1">Score: {totalEarnedScore}</p>
        <p className="text-xs text-slate-400 mt-1">
          {markerFound ? "🟢 Marker Target Acquired!" : "🔴 Scanning for markers..."}
        </p>
        <p className="text-xs font-semibold text-slate-500 mt-1">
          Found: {answeredMarkerIds.length} / {game?.questions?.length || 0}
        </p>
      </div>

      {showQuiz && !isCorrect && activeQuestion && (
        <div className="absolute inset-0 z-50 flex flex-col justify-between p-4 pointer-events-none">
          <div className="mt-20 self-center animate-in slide-in-from-top-10 fade-in duration-500 pointer-events-auto w-full max-w-sm">
            <div className="relative bg-white p-6 rounded-3xl shadow-xl border-2 border-primary-200">
              
              {activeQuestion.imageUrl && (
                <div className="mb-4 rounded-xl overflow-hidden shadow-inner border border-slate-100 flex justify-center bg-slate-50">
                  <img src={activeQuestion.imageUrl} alt="Question" className="max-h-48 object-contain" />
                </div>
              )}

              <h3 className="text-xl md:text-2xl font-extrabold text-slate-800 text-center leading-snug">
                {activeQuestion.question}
              </h3>
              
              {activeQuestion.audioUrl && (
                <div className="mt-4">
                  <audio controls className="w-full h-10" src={activeQuestion.audioUrl}>
                    Your browser does not support the audio element.
                  </audio>
                </div>
              )}

              <div className="absolute -bottom-4 left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-[15px] border-l-transparent border-t-[15px] border-t-white border-r-[15px] border-r-transparent filter drop-shadow-md"></div>
            </div>
          </div>

          <div className="w-full max-w-sm mx-auto mb-8 animate-in slide-in-from-bottom-10 fade-in duration-500 pointer-events-auto">
            <div className="grid grid-cols-2 gap-3">
              {['a', 'b', 'c', 'd'].map(opt => {
                const isWrong = wrongAnswers.includes(opt);
                return (
                  <button
                    key={opt}
                    onClick={() => handleAnswer(opt)}
                    disabled={isWrong}
                    className={`w-full text-center p-4 rounded-2xl border-4 font-bold text-lg transition-all duration-300 ${
                      isWrong 
                        ? "bg-slate-100/50 border-slate-200 text-slate-400 opacity-40 cursor-not-allowed scale-95"
                        : "bg-white/90 backdrop-blur-md border-slate-200 hover:border-secondary-400 hover:bg-secondary-50 active:scale-95 shadow-lg text-slate-700"
                    }`}
                  >
                    {activeQuestion.options[opt]}
                  </button>
                );
              })}
            </div>
            
            {wrongAnswers.length > 0 && (
              <div className="mt-4 text-center animate-bounce">
                <p className="inline-block bg-white/90 text-accent-500 font-bold px-4 py-2 rounded-full shadow-md backdrop-blur-sm border-2 border-accent-100">
                  Almost there! Try another magic spell! ✨
                </p>
              </div>
            )}
            
            <button 
              onClick={handleContinue}
              className="mt-4 w-full bg-slate-800 text-white font-bold py-3 rounded-xl shadow-md active:scale-95 transition-transform"
            >
              Skip / Close
            </button>
          </div>
        </div>
      )}

      {showQuiz && isCorrect && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-sm w-full text-center border-4 border-primary-500">
            <div className="text-6xl mb-4">🎉</div>
            <h3 className="text-3xl font-extrabold text-slate-800 mb-2">Great Job!</h3>
            <p className="text-lg text-slate-600 mb-6">
              You earned <span className="text-primary-600 font-black text-2xl">+{lastEarnedScore}</span> points!
            </p>
            
            {isGameComplete ? (
              <button 
                onClick={() => navigate("/student/leaderboard/" + gameCode)}
                className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-4 rounded-xl transition-all shadow-md"
              >
                See Leaderboard (Quest Complete!)
              </button>
            ) : (
              <button 
                onClick={handleContinue}
                className="w-full bg-primary-500 hover:bg-primary-600 text-white font-bold py-4 rounded-xl transition-all shadow-md"
              >
                Scan Next Marker
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
