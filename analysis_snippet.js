function testSnippet() {
const moves=[],evals=[{cp:0,pv:'',pvSan:'',depth:0,bestMove:'',lines:[{move:'e2e4',cp:10,pv:'e2e4',pvSan:'e4',depth:1}]}];
const result=[];
const i=0,movePly=1,fen='somefen',fenAfter='somefen',isWhitePlaying=true, options={headers:{TimeControl:'5+0'}},bestMove='e2e4',movePlayedSan='e4';
const scoreBefore=0,scoreAfter=10,cpLoss=10, classificationKey='GOOD', bestMoveSan='e4', opponentBestMove='', opponentBestMoveSan='', playerRating=1200, opponentJustBlundered=false, numLegalMoves=20, isCheckmate=false, sacResult={isPieceSacrifice:false}, phase='Middle';
const classification={};
const moveObj={};
(function(){
  result.push({
    move:'e2e4',
    moveSan:movePlayedSan,
    moveUci:'e2e4',
    moveIndex:i,
    moveNumber:1,
    movePly,
    isWhite:isWhitePlaying,
    classification,
    classificationKey,
    evalBefore:scoreBefore,
    evalAfter:scoreAfter,
    swing:scoreAfter-scoreBefore,
    cpLoss,
    expectedLoss:0.1,
    playerRating,
    playerEdgeBefore:10,
    playerEdgeAfter:20,
    bestMove,
    bestMoveSan,
    opponentBestMove,
    opponentBestMoveSan,
    bestMovePv:evals[i].pv,
    bestMovePvSan:evals[i].pvSan,
    alternatives:[],
    depth:evals[i].depth,
    fen,
    fenAfter,
    phase,
    planTags:[],
    mateThreat:null,
    endgameNotes:null,
    isCriticalMoment:false,
    severityScore:1.2,
    opponentJustBlundered,
    coachText: this._coachingText({
      classification,
      cpLoss,
      expectedLoss:0.1,
      isBestMove:true,
      bestMoveSan,
      bestMove:evals[i].bestMove,
      opponentBestMove,
      opponentBestMoveSan,
      moveUci:'e2e4',
      moveSan:movePlayedSan,
      movePly,
      scoreBefore,
      scoreAfter,
      isWhite:isWhitePlaying,
      playerRating,
      opponentJustBlundered,
      fenBefore:fen,
      fenAfter,
    }),
  });
})();
result.opening = 'foo';
}
