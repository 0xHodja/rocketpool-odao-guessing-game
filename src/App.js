import { useEffect, useState } from "react";
import { Button } from "react-bootstrap";
import CryptoJS from "crypto-js";
import { useSearchParams, useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import format from "date-fns/format";
import { BarLoader } from "react-spinners";

import RocketRewardsPoolABI from "./RocketRewardsPoolABI.json";
import odaoJson from "./odao.json";

const backgroundStyle = {
  backgroundImage: `url("/background.png")`,
  backgroundRepeat: "no-repeat",
  backgroundAttachment: "fixed",
  backgroundPosition: "right bottom",
  minHeight: "100vh",
};

const getWindowDimensions = () => {
  const { innerWidth: width, innerHeight: height } = window;
  return {
    width,
    height,
  };
};

const useWindowDimensions = () => {
  const [windowDimensions, setWindowDimensions] = useState(getWindowDimensions());
  useEffect(() => {
    function handleResize() {
      setWindowDimensions(getWindowDimensions());
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  return windowDimensions;
};

function App() {
  const [page, setpage] = useState(1);
  const [odaoMembers, setodaoMembers] = useState([]);
  const [odaoRankGuess, setodaoRankGuess] = useState([]);
  const [warningMessage, setwarningMessage] = useState("");
  const [hashSalt, sethashSalt] = useState(2689);
  const [hash, sethash] = useState("");
  const [submissions, setSubmissions] = useState([]);
  const [loadingSubmissions, setloadingSubmissions] = useState(true);

  const { height, width } = useWindowDimensions();

  const odaoConsensusRequired = 10;

  const [params] = useSearchParams();
  const navigate = useNavigate();

  // page counter
  useEffect(() => {
    fetch(`https://api.countapi.xyz/hit/0xhodja/rocketpool_odao_treegen_game`);
  }, []);

  // get odao members on load
  useEffect(() => {
    let data = odaoJson;
    let members = data.oracle.members.members;
    members.sort((a, b) => (a.id > b.id ? 1 : -1));
    setodaoMembers(members);
  }, []);

  // submissions for verification
  const getRewardSubmissions = async () => {
    if (odaoMembers.length === 0) {
      return;
    }
    let res = await fetch(`https://api.etherscan.io/api?module=account&action=txlist&address=0xA805d68b61956BC92d556F2bE6d18747adAeEe82&apikey=${process.env.REACT_APP_ETHERSCAN_API_KEY}`);
    let data = await res.json();
    data = data.result;
    const currentTime = new Date().valueOf() / 1e3;
    data = data
      .filter((x) => x.isError === "0")
      .filter((x) => x.txreceipt_status === "1")
      .filter((x) => parseInt(x.timeStamp) > currentTime - 3600 * 24 * 14) // last 14 days rolling
      .filter((x) => x.functionName === "submitRewardSnapshot(tuple _submission)");

    const iface = new ethers.utils.Interface(RocketRewardsPoolABI);

    let tempMerkleRoots = {};
    let txs = data
      .map((x) => {
        let datastring = x.input;
        let txInputs = iface.decodeFunctionData("submitRewardSnapshot", datastring);
        txInputs = txInputs[0];
        tempMerkleRoots[txInputs.merkleRoot] = (tempMerkleRoots[txInputs.merkleRoot] || 0) + 1;
        return { address: x.from, timestamp: x.timeStamp, hash: x.hash, merkleRoot: txInputs.merkleRoot };
      })
      .sort((a, b) => (parseInt(a.timestamp) > parseInt(b.timestamp) ? 1 : -1))
      .map((x) => {
        return { ...x, id: getODAONameByAddress(x.address), valid: tempMerkleRoots[x.merkleRoot] >= odaoConsensusRequired };
      });

    setSubmissions(txs);
    setloadingSubmissions(false);
  };

  // parse query strings on load
  useEffect(() => {
    let guess = params.get("guess");
    let salt = params.get("salt");
    let verify = params.get("verify");
    if (guess) {
      let odaorank = guess.split(",");
      setodaoRankGuess(odaorank);
      if (odaorank.length === 0) {
        setpage(1);
      } else if (odaorank.length < odaoConsensusRequired) {
        setpage(2);
      } else if (odaorank.length === odaoConsensusRequired) {
        setpage(3);
      }
    }
    if (salt) {
      sethashSalt(salt);
    } else {
      sethashSalt(parseInt(Math.random() * 10000));
    }
    if (verify) {
      setpage(4);
    }
  }, []);

  useEffect(() => {
    getRewardSubmissions();
  }, [odaoMembers]);

  useEffect(() => {
    setloadingSubmissions(false);
  }, [submissions]);

  useEffect(() => {
    if (odaoRankGuess.length === odaoConsensusRequired) {
      sethash(CryptoJS.SHA256(odaoRankGuess.join(",") + hashSalt).toString());
    }
  }, [odaoRankGuess]);

  useEffect(() => {
    updateURLParams();
  }, [odaoRankGuess, hashSalt, hash]);

  const updateURLParams = () => {
    let urlParams = [];
    if (odaoRankGuess.length > 0) {
      urlParams.push("?guess=" + odaoRankGuess.join(","));
    }
    if (hashSalt) {
      urlParams.push("&salt=" + hashSalt);
    }
    // if (odaoRankGuess.length === 8) {
    //   urlParams.push("&hash=" + hash);
    // }
    navigate({
      pathname: "/",
      search: urlParams.join(""),
    });
  };

  const shortenAddress = (address) => {
    return address.slice(0, 8) + "....." + address.slice(address.length - 6);
  };

  const getODAONameByAddress = (address) => {
    try {
      return odaoMembers.find((x) => x.address.toLowerCase() === address.toLowerCase()).id;
    } catch (e) {
      return "Unknown ODAO";
    }
  };

  const handleAddMember = (id) => {
    if (odaoRankGuess.length === odaoConsensusRequired) {
      setwarningMessage(`You have reached ${odaoConsensusRequired} guesses which is the length required to reach consensus. Click members below to remove them before adding more.`);
      return;
    }
    if (odaoRankGuess.some((x) => x === id)) {
      setwarningMessage(`You have already selected this oDAO member "${id}". Click them in your guess below to remove them.`);
      return;
    }
    let newGuess = [...odaoRankGuess];
    newGuess.push(id);
    setodaoRankGuess(newGuess);
    setwarningMessage("");
  };

  const handleRemoveMember = (id) => {
    let newGuess = [...odaoRankGuess];
    newGuess = newGuess.filter((x) => x !== id);
    setodaoRankGuess(newGuess);
    setwarningMessage("");
  };

  const handleMoveMember = (idx, move) => {
    let nextPos = Math.max(Math.min(idx + move, odaoRankGuess.length - 1), 0);
    let newGuess = [...odaoRankGuess];
    newGuess[nextPos] = odaoRankGuess[idx];
    newGuess[idx] = odaoRankGuess[nextPos];
    setodaoRankGuess(newGuess);
  };

  const handleClearMembers = () => {
    setodaoRankGuess([]);
  };

  const handleRefreshSubmissions = () => {
    setloadingSubmissions(true);
    getRewardSubmissions();
  };

  const handleCopyText = (text) => {
    navigator.clipboard.writeText(text);
  };

  const pageInstructions = () => {
    return (
      <>
        <div className="row pb-3">
          <div className="col text-center">
            <Button variant="success" size="lg" onClick={() => setpage(2)}>
              Begin Game
            </Button>
          </div>
        </div>
        <div className="row pb-3">
          <div className="col text-center">
            <h4 className="mb-3">How this works</h4>
            <img src="./steps.png" style={{ width: "100%" }}></img>
            <ol className="text-start">
              <li>Select {`${odaoConsensusRequired}`} oDAO members in order of who you think will submit their merkle trees onchain first</li>
              <li>A SHA256 hash of your answer combined with a random salt, will be generated</li>
              <ul>
                <li>The salt is just to ensure someone else with the same answer as you does not have the same SHA256 hash</li>
              </ul>
              <li>Copy your SHA256 hash into discord to stake your claim on the truth</li>
              <ul>
                <li>Before oDAO reaches consensus, only submit your hash on discord. </li>
                <li>You can reveal your answer after the oDAO has reached consensus on the merkle root.</li>
              </ul>
              <li>Save the url containing the hash and the salt of your answer</li>
              <li>After submissions are complete, reply to your original hash message by sharing your url in discord to reveal your answer and confirm your hash</li>
              <li>Clicking on the link you saved will give you a score for your answer</li>
            </ol>
          </div>
        </div>
        <div className="row pb-3">
          <div className="col text-center">
            <h4 className="mb-3">References</h4>
            <a href="https://etherscan.io/address/0xa805d68b61956bc92d556f2be6d18747adaeee82" target="_blank" rel="noreferrer">
              ODAO Reward Submissions Contract
            </a>
            <br />
            <a href="https://rocketscan.io/dao" target="_blank" rel="noreferrer">
              RocketScan.io DAO page (oDAO member source)
            </a>
            <br />
            <a href="https://dune.com/greywizard/rocket-pool-odao-stats" target="_blank" rel="noreferrer">
              Greywizard's Dune ODAO Dashboard
            </a>
          </div>
        </div>
        <div className="row pb-3">
          <div className="col text-center">
            <h4 className="mb-3">Source Code</h4>
            <a className="text-decoration-none" href="https://github.com/0xHodja/rocketpool-odao-guessing-game" target="_blank" rel="noreferrer">
              <i class="fa-brands fa-github"></i> 0xHodja/rocketpool-odao-guessing-game
            </a>
          </div>
        </div>
      </>
    );
  };

  const pageSelect = () => {
    return (
      <>
        <div className="row pb-3">
          <div className="col text-center">
            <h4 className="mb-3">🏇🏽 Rank oDAO Members</h4>
            {odaoRankGuess.length === 0 && <p>Select oDAO members in the order they will submit their trees.</p>}
            {odaoRankGuess.length !== odaoConsensusRequired && <p>{`Select ${odaoConsensusRequired - odaoRankGuess.length} more member${odaoRankGuess.length < odaoConsensusRequired - 1 ? "s" : ""}`}</p>}
            <div className="d-flex flex-row flex-wrap gap-1 justify-content-center">
              {odaoRankGuess.length === odaoConsensusRequired ? (
                <div className="d-flex flex-column gap-1 justify-content-center">
                  <Button variant="success" onClick={() => setpage(3)}>
                    <b>Next step: Get your hash 🍪</b>
                  </Button>
                  {/* <Button variant="outline-danger" onClick={() => handleRemoveMember(odaoRankGuess[odaoRankGuess.length - 1])}>
                    Remove last guess
                  </Button> */}
                </div>
              ) : (
                odaoMembers
                  .filter((x) => !odaoRankGuess.some((y) => x.id === y))
                  .map((x) => {
                    return (
                      <Button key={x.id} className="border border-2 rounded-1 border-secondary py-2 text-dark bg-light" variant="outline-warning" size="sm" style={{ width: "270px" }} onClick={() => handleAddMember(x.id)}>
                        <div className="d-flex flex-row gap-2 justify-content-center">
                          <img src={`./${x.id}.jpg`} className="rounded-circle mx-2" width="50px" />
                          <div className="d-flex flex-column text-start">
                            <span className="fw-bold" style={{ textTransform: "capitalize" }}>
                              {x.id}
                            </span>
                            <span className="text-sm">{shortenAddress(x.address)}</span>
                          </div>
                        </div>
                      </Button>
                    );
                  })
              )}
            </div>
            {warningMessage ? <div className="m-3 p-3 bg-danger text-white fw-bold">{warningMessage}</div> : <></>}
            {odaoRankGuess.length > 0 && (
              <Button variant="outline-danger" size="sm" className="mt-3" onClick={() => handleClearMembers()}>
                Reset/Clear All
              </Button>
            )}
          </div>
        </div>
        <div className="row pb-3">
          <div className="col text-center">
            <hr />
            <h4 className="mb-3">🏁 Your Guess</h4>
            <div className="d-flex flex-column flex-wrap gap-1 justify-content-center align-items-center">
              {odaoRankGuess.map((id, idx) => {
                return (
                  <div key={"guess_" + id} className="d-flex flex-row gap-1 border border-2 rounded-1 border-secondary p-2 justify-content-between align-items-center bg-light" style={{ width: "380px" }}>
                    <span style={{ textTransform: "capitalize" }}>
                      <div className="d-inline rounded-3 bg-secondary p-2 text-white" style={{ minWidth: "50px" }}>
                        #{idx + 1}
                      </div>{" "}
                      <img src={`./${id}.jpg`} className="rounded-circle mx-2" width="50px" />
                      <a className="text-decoration-none fw-bold" href={odaoMembers.find((x) => x.id === id).url} target="_blank" rel="noreferrer">
                        {id}
                      </a>
                    </span>
                    <div className="d-flex flex-row">
                      <Button className="border-0 p-1" variant="outline-secondary" size="sm" onClick={() => handleMoveMember(idx, -1)}>
                        <span className="text-danger">🔼</span>
                      </Button>
                      <Button className="border-0 p-1" variant="outline-secondary" size="sm" onClick={() => handleMoveMember(idx, 1)}>
                        <span className="text-danger">🔽</span>
                      </Button>
                      <Button className="border-0 p-1" variant="outline-danger" size="sm" onClick={() => handleRemoveMember(id)}>
                        <span className="text-danger">❌</span>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </>
    );
  };

  const pageSubmit = () => {
    if (odaoRankGuess.length < odaoConsensusRequired) {
      return (
        <div className="row pb-3">
          <div className="col text-center">
            <Button className="bg-warning mb-3 text-dark fw-bold" onClick={() => setpage(2)}>
              {odaoRankGuess.length > 0 ? `Select ${odaoConsensusRequired - odaoRankGuess.length} more member${odaoConsensusRequired - odaoRankGuess.length > 1 ? "s" : ""}` : "Rank oDAO members first"}
            </Button>
          </div>
        </div>
      );
    }

    return (
      <>
        <div className="row pb-3">
          <div className="col text-center">
            <Button className="my-3" variant="outline-dark" size="sm" onClick={() => setpage(2)}>
              Click to go back to change your answer
            </Button>

            <h4>🔑 Hash Output</h4>
            <div className="d-flex flex-column justify-content-center align-items-center border border-2 rounded-1 p-3 bg-light my-3">
              <h5>Step 1</h5>
              Copy the hash below and paste into Discord to stake your claim to victory
              <div className="my-5">
                <span className="fw-bold text-break">{hash}</span>
              </div>
            </div>
            <div className="d-flex flex-column justify-content-center align-items-center border border-2 rounded-1 p-3 bg-light">
              <h5>Step 2</h5>
              Save this link below. It contains the salt you need for verification, without it you cannot prove your hash matches your guess.
              <div className="my-5">
                <a className="text-break" href={window.location.href + "&verify=true"}>
                  {window.location.href + "&verify=true"}
                </a>
                <p className="">
                  <i>Salt: {hashSalt}</i>
                </p>
                <div className="mt-5">After oDAO reaches consensus, reply to your post in discord where you posted the hash, with this url. This reveals your answer and proves the original hash matches your guess.</div>
              </div>
            </div>
          </div>
        </div>

        <div className="row py-3">
          <div className="col text-center">
            <Button variant="success" onClick={() => setpage(4)}>
              <b>Next step: Wait for oDAO submissions</b>
            </Button>
          </div>
        </div>

        <div className="row py-3">
          <div className="col">
            <div className="d-flex flex-row justify-content-center">
              <div className="text-center font-monospace border border-2 rounded-1 p-3 bg-light" style={{ width: "400px" }}>
                <b>Discord paste (for bragging rights):</b>
                <br></br>
                {odaoRankGuess.map((id) => {
                  return (
                    <div key={"discord_" + id}>
                      {id}
                      <br />
                    </div>
                  );
                })}
                <br />
                <p>Keep your answer secret until after oDAO reaches consensus</p>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  };

  const scoringArray = () => {
    let j = 0;
    let result = [];

    let rootCount = {};
    submissions.map((x) => (rootCount[x.merkleRoot] = (rootCount[x.merkleRoot] || 0) + 1));
    let mostValidRoot = "0x";
    if (submissions.length > 0) {
      mostValidRoot = Object.entries(rootCount)
        .map(([k, v]) => [k, v])
        .sort((a, b) => (a[1] < b[1] ? 1 : -1))[0][0];
    }
    let validSubmissions = submissions.filter((x) => x.merkleRoot === mostValidRoot);
    console.log(rootCount);
    console.log(validSubmissions);

    for (let i = 0; i < odaoRankGuess.length; i++) {
      let guess = odaoRankGuess[i];
      let odao = validSubmissions[j];
      j += 1;
      result.push({ guess, odao });
    }

    for (let i = 0; i < result.length; i++) {
      if (result[i].guess === result[i].odao?.id) {
        result[i]["score"] = 1;
      } else if (result[i].guess === result[i - 1]?.odao?.id) {
        result[i]["score"] = 0.25;
      } else if (result[i].guess === result[i + 1]?.odao?.id) {
        result[i]["score"] = 0.25;
      } else {
        result[i]["score"] = 0;
      }
    }

    return result;
  };

  const pageVerify = () => {
    return (
      <>
        <div className="row pb-3">
          <div className="col text-center">
            <Button variant="outline-dark" size="sm" onClick={() => handleRefreshSubmissions()}>
              🔄 Refresh submissions
            </Button>
          </div>
        </div>
        <div className="row pb-3">
          <div className="col text-center">
            {loadingSubmissions ? (
              <div className="d-flex flex-row justify-content-center my-5">
                <BarLoader />
              </div>
            ) : (
              renderSubmissionsTable()
            )}
          </div>
        </div>

        {odaoRankGuess.length < odaoConsensusRequired ? (
          <div className="row pb-3">
            <div className="col text-center">
              <Button className="bg-warning mb-3 text-dark fw-bold" onClick={() => setpage(2)}>
                {odaoRankGuess.length > 0 ? `Select ${odaoConsensusRequired - odaoRankGuess.length} more member${odaoConsensusRequired - odaoRankGuess.length > 1 ? "s" : ""}` : "Rank oDAO members first"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="row pb-3">
            <hr className="" />
            <div className="col text-center">
              <h4>🏁 Your Guess and Score Card ✔️</h4>
              {loadingSubmissions ? (
                <div className="d-flex flex-row justify-content-center my-5">
                  <BarLoader />
                </div>
              ) : (
                <>
                  <p className="fw-bold text-break">
                    Hash: {hash}
                    <br />
                    Score: {scoringArray().reduce((a, b) => a + b.score || 0, 0)} {submissions.reduce((a, b) => a + (b.valid ? 1 : 0), 0) === odaoConsensusRequired ? "" : "(not your final score until consensus is reached)"}
                  </p>
                  <div className="m-auto" style={{ maxWidth: "400px" }}>
                    <div className="table-responsive small">
                      <table className="table table-sm table-bordered text-center align-middle">
                        <thead className="table-dark">
                          <tr>
                            <th>Your Guess</th>
                            <th>ODAO Position</th>
                            <th>Score</th>
                          </tr>
                        </thead>
                        <tbody>
                          {scoringArray().map((x) => {
                            let rowClass = "table-secondary";

                            if (x.odao) {
                              rowClass = x.score === 1 ? "table-success" : x.score === 0 ? "table-danger" : "table-warning";
                            }
                            return (
                              <tr className={rowClass} key={"score_" + x.guess}>
                                <td>{x.guess}</td>
                                <td>{x.odao?.address ? x.odao.id : ""}</td>
                                <td>{x.score ? x.score : 0}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <ul className="text-start">
                        <li>You get 1 point for correct guess</li>
                        <li>You get 0.25 points for guess that is off by 1 position</li>
                      </ul>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </>
    );
  };

  const renderSubmissionsTable = () => {
    return (
      <>
        {submissions.length === 0 ? (
          <div className="text-center my-5">
            <b>No submissions detected for this rewards period yet...</b>
          </div>
        ) : (
          <div className="table-responsive small">
            <table className="table table-sm table-bordered text-center align-middle">
              <thead className="table-dark">
                <tr>
                  <th>ODAO Address</th>
                  <th style={{ minWidth: "200px" }}>ODAO Name</th>
                  <th>Hash</th>
                  <th style={{ minWidth: "150px" }}>Time (local)</th>
                  <th>Merkle Root</th>
                  <th>Consensus</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((x) => {
                  let rowClass = x.valid ? "table-success" : "table-warning";
                  let oDAOName = x.id;
                  return (
                    <tr key={x.hash}>
                      <td className={rowClass}>
                        <a className="text-decoration-none" href={`https://etherscan.io/address/${x.address}`} target="_blank" rel="noreferrer">
                          {shortenAddress(x.address)}
                        </a>{" "}
                      </td>
                      <td className={`${rowClass} "text-left"`}>
                        <img src={`./${oDAOName}.jpg`} className="rounded-circle mx-2" width="30px" />

                        <b>{oDAOName}</b>
                      </td>
                      <td className={rowClass}>
                        <a className="text-decoration-none" href={`https://etherscan.io/tx/${x.hash}`} target="_blank" rel="noreferrer">
                          {shortenAddress(x.hash)}
                        </a>
                      </td>
                      <td className={rowClass}>{format(new Date(parseInt(x.timestamp) * 1000), "yyyy-MM-dd HH:mm")}</td>
                      <td className={rowClass}>{shortenAddress(x.merkleRoot)}</td>
                      <td className={rowClass}>{x.valid ? "Valid" : "Pending"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p>{submissions.reduce((a, b) => a + (b.valid ? 1 : 0), 0) >= odaoConsensusRequired ? "Consensus reached." : "Results are pending until consensus is reached..."}</p>
          </div>
        )}
      </>
    );
  };

  const getPage = (id) => {
    let pages = {
      1: pageInstructions,
      2: pageSelect,
      3: pageSubmit,
      4: pageVerify,
    };
    return pages[id]();
  };

  return (
    <div className="App" style={backgroundStyle}>
      <div className="container-fluid">
        <div className="row bg-dark text-white py-3">
          <div className="col text-center">
            <h1>🧠 Rocketpool ODAO Treegen Guessing Game 🧠</h1>
          </div>
        </div>
        <div className="row bg-secondary text-white py-2">
          <div className="col text-center">
            <div className="d-flex flex-wrap flex-row gap-3 justify-content-center">
              <Button
                variant={page === 1 ? "light" : "outline-light"}
                size="sm"
                className="fw-bold"
                style={{ width: "110px" }}
                onClick={() => {
                  setpage(1);
                }}
              >
                1 Instructions
              </Button>
              <Button
                variant={page === 2 ? "light" : "outline-light"}
                size="sm"
                className="fw-bold"
                style={{ width: "110px" }}
                onClick={() => {
                  setpage(2);
                }}
              >
                2 Select
              </Button>
              <Button
                variant={page === 3 ? "light" : "outline-light"}
                size="sm"
                className="fw-bold"
                style={{ width: "110px" }}
                onClick={() => {
                  setpage(3);
                }}
              >
                3 Submit
              </Button>
              <Button
                variant={page === 4 ? "light" : "outline-light"}
                size="sm"
                className="fw-bold"
                style={{ width: "110px" }}
                onClick={() => {
                  setpage(4);
                }}
              >
                4 Verify
              </Button>
            </div>
          </div>
        </div>
      </div>
      <div className="container mt-3">{getPage(page)}</div>
    </div>
  );
}

export default App;
