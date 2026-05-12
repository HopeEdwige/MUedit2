%% SEMGDEMO_Mariam_Final - Simulation complète et Export MUedit
clear; close all; clc;

% --- 1. Paramètres de Simulation (Critères Mariam & SEMGDEMO) ---
duration = 5;       % Durée en secondes
prec = 0.0001;      % Pas de temps (Fs = 10000 Hz)
fs = 1/prec;
t_vec = 0:prec:duration-prec;
rMUS = 20;          % Rayon du muscle (mm)
nF = 100;           % Nombre de fibres de base
nCanaux = 64;       % Grille HD-sEMG

% --- 2. Génération de la source IAP (Action Potential Intracellulaire) ---
t_iap = 0:0.1:25; % ms
A1 = 1690.3; A2=10; A3=1; A4=8.5; A5=0.015; A6=0.8;
IAP = A1*[[A3*t_iap.^3+A2.*t_iap.^2-A4*A5*t_iap-A5].*exp(-A4*t_iap)+A5].*exp(-A6*t_iap);
DIAP = [zeros(1,2) diff(IAP)];

% --- 3. Création du Muscle (100 MUs selon Mariam) ---
disp('Génération des 100 Unités Motrices...');
[~, UM_S]   = MuscleS(33, nF, rMUS, 1); 
[~, UM_FR]  = MuscleFR(17, nF, rMUS, 1); 
[~, UM_FIN] = MuscleFIN(17, nF, rMUS, 1); 
[~, UM_FF]  = MuscleFF(33, nF, rMUS, 1); 
All_MUs = [UM_S, UM_FR, UM_FIN, UM_FF];

% --- 4. Calcul des signaux EMG (Convolution & Sommation Spatiale) ---
EMG_grid = zeros(nCanaux, length(t_vec));
Kan = 5; z0 = 30; x0 = 0; y0 = 15; L1 = 65; L2 = 55; v_prop = 4;

% On définit une grille d'électrodes simplifiée (8x8)
[elec_x, elec_y] = meshgrid(linspace(-10, 10, 8), linspace(-10, 10, 8));
elec_x = elec_x(:); elec_y = elec_y(:);

disp('Simulation des trains d''impulsions et calcul sEMG...');
for i = 1:length(All_MUs)
    % Génération des Spikes (Spikepoissgennorm)
    % On simule un recrutement à 20% MVC (Mariam) : Seules les 36 premières MUs sont actives
    if i <= 36 
        [spike, ~] = spikepoissgennorm(duration, 15, 0.01, 0.002, prec);

        % Pour chaque MU, on calcule le potentiel d'unité motrice (MUP)
        % Note: On simplifie ici en prenant le centre de la MU pour le VC
        yi = imag(All_MUs(i).pos);
        xi = real(All_MUs(i).pos);
        zep = 0; % Position d'innervation simplifiée

        % Calcul du Transfert de Volume (IR.m)
        for ch = 1:nCanaux
            [~, DIR] = IR(0:0.1:50, z0, elec_x(ch), elec_y(ch), zep, yi, xi, v_prop, Kan, L1, L2);
            MUP = (1/v_prop) * conv(DIAP, DIR, 'same');

            % Ajout du train d'impulsions au canal
            train = conv(spike, MUP, 'same');
            EMG_grid(ch, :) = EMG_grid(ch, :) + train;
        end
    end
end

% --- 5. Figures SEMGDEMO ---
figure(1);
subplot(2,1,1); plot(t_iap, IAP); title('Source IAP');
subplot(2,1,2); plot(EMG_grid(1, 1:1000)); title('Signal sEMG (Canal 1)');

figure(2); % Carte du muscle
hold on;
for i = 1:length(All_MUs)
    plot(All_MUs(i).pos + All_MUs(i).Fpos, '.'); 
end
plot(rMUS*exp(1j*(0:0.1:2*pi+0.1)), 'k--');
title('Répartition spatiale des 100 MUs'); axis equal;

% --- 6. Export pour MUedit ---
signal.data = EMG_grid;
signal.fsamp = fs;
signal.nChan = nCanaux;
signal.gridname = {'Grille_Mariam_100MU'};
signal.labels = arrayfun(@(x) sprintf('Ch%d', x), 1:nCanaux, 'UniformOutput', false);

save('Export_Mariam_MUedit.mat', 'signal', '-v7.3');
disp('Fichier Export_Mariam_MUedit.mat généré avec succès.');